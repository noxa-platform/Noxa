import { describe, it, expect, beforeEach, vi } from 'vitest';

// 通知（誕生日・次回アクション・ご無沙汰・日次サマリ）の**配信対象の決め方**と、
// 「送れなかった」の可視化を固定する（Day119）。
//
// 旧実装の実バグ:
//   `listUidsWithPrefEnabled` は `account_app_settings` を全件走査するだけだった。
//   この doc は通知設定画面で**保存を押したときに初めて作られる**ため、
//   既定 ON（birthday / nextAction / longTimeNoSee）のはずの利用者でも、
//   設定画面を一度も開いていなければ**通知の対象にすら入らない**。
//   端末登録（push トークン）まで済ませて待っている人に、誕生日も期限も一度も届かなかった。
//
//   さらに `sendToUser` の 'no-token' は集計にもログにも出ず、
//   「対象なのに誰にも届いていない」ことが統計から読み取れなかった。

const mocks = vi.hoisted(() => ({ db: vi.fn(), messaging: vi.fn() }));
vi.mock('../../functions/src/admin', () => ({ db: mocks.db, messaging: mocks.messaging }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__ts__', increment: (n: number) => ({ __increment: n }) },
}));

import { listUidsWithPrefEnabled } from '../../functions/src/lib/prefs';
import { sendToUser } from '../../functions/src/lib/push';

type Doc = Record<string, unknown>;

/** collection().get() / doc().get() / doc().set() を持つ最小フェイク */
function makeDb(collections: Record<string, Record<string, Doc>>) {
  const written: Record<string, Doc[]> = {};
  const docsOf = (name: string) => Object.entries(collections[name] ?? {});
  const db = {
    collection: (name: string) => ({
      get: async () => ({
        docs: docsOf(name).map(([id, data]) => ({ id, data: () => data })),
        forEach(cb: (d: { id: string; data: () => Doc }) => void) {
          for (const [id, data] of docsOf(name)) cb({ id, data: () => data });
        },
      }),
    }),
    doc: (path: string) => {
      const [col, ...rest] = path.split('/');
      const id = rest.join('/');
      return {
        get: async () => ({ exists: collections[col]?.[id] !== undefined, data: () => collections[col]?.[id] }),
        set: async (d: Doc) => { (written[path] ??= []).push(d); },
        delete: async () => { delete collections[col]?.[id]; },
      };
    },
  };
  return { db, written };
}

describe('listUidsWithPrefEnabled（通知の配信対象）', () => {
  beforeEach(() => { mocks.db.mockReset(); });

  it('★端末登録済みで設定 doc を作っていない人も既定 ON として対象に入る（旧実装は素通りしていた）', async () => {
    const { db } = makeDb({
      account_app_settings: {},                    // 誰も設定を保存していない
      notification_push_tokens: { u1: { token: 't1' } }, // 端末登録だけ済ませた人
    });
    mocks.db.mockReturnValue(db);

    await expect(listUidsWithPrefEnabled('birthday')).resolves.toEqual(['u1']);
  });

  it('明示的に OFF にした人は対象から外れる（既定を上書きできる）', async () => {
    const { db } = makeDb({
      account_app_settings: { u1: { notificationPrefs: { birthday: false } } },
      notification_push_tokens: { u1: { token: 't1' } },
    });
    mocks.db.mockReturnValue(db);

    await expect(listUidsWithPrefEnabled('birthday')).resolves.toEqual([]);
  });

  it('既定 OFF の日次サマリは、明示的に ON にした人だけが対象', async () => {
    const { db } = makeDb({
      account_app_settings: { u2: { notificationPrefs: { dailySummary: true } } },
      notification_push_tokens: { u1: { token: 't1' }, u2: { token: 't2' } },
    });
    mocks.db.mockReturnValue(db);

    await expect(listUidsWithPrefEnabled('dailySummary')).resolves.toEqual(['u2']);
  });

  it('設定あり・トークンありの両方に居ても二重にならない（和集合）', async () => {
    const { db } = makeDb({
      account_app_settings: { u1: { notificationPrefs: { nextAction: true } }, u3: {} },
      notification_push_tokens: { u1: { token: 't1' } },
    });
    mocks.db.mockReturnValue(db);

    const uids = await listUidsWithPrefEnabled('nextAction');
    expect(uids.filter((u) => u === 'u1')).toHaveLength(1);
    expect(new Set(uids)).toEqual(new Set(['u1', 'u3'])); // 設定 doc だけの人も従来どおり対象
  });
});

describe('sendToUser（端末未登録を「無かったこと」にしない）', () => {
  beforeEach(() => { mocks.db.mockReset(); mocks.messaging.mockReset(); });

  it('★トークンが無いときは no-token を返し、その事実を統計に残す', async () => {
    const { db, written } = makeDb({ notification_push_tokens: {} });
    mocks.db.mockReturnValue(db);

    await expect(sendToUser('u1', { title: 't', body: 'b' }, 'birthday')).resolves.toBe('no-token');

    // notification_push_stats/{JST日付} に noToken が積まれる
    const statWrites = Object.entries(written).filter(([path]) => path.startsWith('notification_push_stats/'));
    expect(statWrites).toHaveLength(1);
    expect(JSON.stringify(statWrites[0][1])).toContain('noToken');
  });

  it('token フィールドが空の doc も no-token として扱う（doc だけ残った状態）', async () => {
    const { db } = makeDb({ notification_push_tokens: { u1: { platform: 'ios' } } });
    mocks.db.mockReturnValue(db);

    await expect(sendToUser('u1', { title: 't', body: 'b' }, 'birthday')).resolves.toBe('no-token');
  });

  it('トークンがあれば送信し sent を返す（通常経路の回帰防止）', async () => {
    const { db } = makeDb({ notification_push_tokens: { u1: { token: 't1' } } });
    mocks.db.mockReturnValue(db);
    const send = vi.fn().mockResolvedValue('ok');
    mocks.messaging.mockReturnValue({ send });

    await expect(sendToUser('u1', { title: 't', body: 'b' }, 'birthday')).resolves.toBe('sent');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
