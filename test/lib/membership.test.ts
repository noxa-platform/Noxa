import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  isActiveMembership,
  activeMemberships,
  activeMembershipIds,
  keepMembershipWorkspace,
  ACTIVE_STATUS,
} from '../../src/lib/membership';

// 「所属している」の単一判定（Day122）。
//
// 所属の正本は shop_shops/{shopId}/members/{uid} だが、クライアントは逆引き index
// account_users/{uid}/memberships/{shopId} しか読めない。Day120〜121 で **CF 側だけ**が
// status と店舗の生存を見るようになり、クライアント 8 箇所は `docs.map((d) => d.id)` のまま
// ＝**同じ index を 2 つの基準で読む**状態になっていた（どちらかが必ず嘘になる）。

type Doc = { id: string; data: () => Record<string, unknown> | undefined };
const doc = (id: string, data?: Record<string, unknown>): Doc => ({ id, data: () => data });

describe('isActiveMembership（在籍しているか）', () => {
  it('status: active は在籍', () => {
    expect(isActiveMembership({ status: 'active' })).toBe(true);
  });

  it('★status 未設定は在籍として扱う（CF の既定 `after.status ?? active` と同じ）', () => {
    // /store/new のオーナー自己登録は status を書かない。ここを「不明＝非在籍」に倒すと、
    // 旧 doc のスタッフから店舗 UI が丸ごと消える
    expect(isActiveMembership({})).toBe(true);
    expect(isActiveMembership(undefined)).toBe(true);
  });

  it('退店済み（active 以外）は在籍ではない', () => {
    expect(isActiveMembership({ status: 'left' })).toBe(false);
    expect(isActiveMembership({ status: 'suspended' })).toBe(false);
  });

  it('文字列以外の status は既定（在籍）に倒す（型崩れで所属を消さない）', () => {
    expect(isActiveMembership({ status: 42 })).toBe(true);
    expect(isActiveMembership({ status: null })).toBe(true);
  });
});

describe('activeMemberships / activeMembershipIds', () => {
  it('★退店済みを除いた在籍分だけを返す', () => {
    const docs = [
      doc('s1', { status: 'active', shopName: '本店' }),
      doc('s2', { status: 'left', shopName: '前の店' }),
      doc('s3', { shopName: '旧 doc（status 無し）' }),
    ];
    expect(activeMembershipIds(docs)).toEqual(['s1', 's3']);
  });

  it('shopId フィールドがあればそちらを優先（doc id と食い違う古いデータ対策）', () => {
    expect(activeMembershipIds([doc('legacy', { shopId: 's9' })])).toEqual(['s9']);
  });

  it('店舗名は CF の denormalize を使い、空文字は未設定として扱う', () => {
    expect(activeMemberships([doc('s1', { shopName: '本店' }), doc('s2', { shopName: '' })])).toEqual([
      { id: 's1', name: '本店', role: undefined },
      { id: 's2', name: undefined, role: undefined },
    ]);
  });

  it('role も拾う（用途ごとの絞り込みは呼び出し側の責務）', () => {
    expect(activeMemberships([doc('s1', { role: 'manager' })])[0].role).toBe('manager');
  });
});

describe('keepMembershipWorkspace（消えた店舗を切替リストに残さない）', () => {
  it('★削除済みと確認できた店舗だけ落とす', () => {
    expect(keepMembershipWorkspace(false)).toBe(false);
  });

  it('★確認できなかった（通信断など）は落とさない', () => {
    // ここを落とすと、通信が不安定なだけで切替先が消え、個人ワークスペース選択中の
    // ユーザーが自分の店へ戻れなくなる（Day105/Day109 の行き止まり）
    expect(keepMembershipWorkspace(null)).toBe(true);
  });

  it('実在する店舗は当然残す', () => {
    expect(keepMembershipWorkspace(true)).toBe(true);
  });
});

// --- 定義のドリフト防止ガード（Day122） ---
// 判定を 1 か所に寄せても、次に index を読む人が生で `docs.map((d) => d.id)` と書けば元に戻る。
// 「読み手が増えたらガードが赤くなる」形にしておく。

const SRC = join(process.cwd(), 'src');

function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p));
    else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const READERS = files(SRC)
  .map((p) => ({ path: relative(process.cwd(), p).split(/[\\/]/).join('/'), src: readFileSync(p, 'utf8') }))
  .filter((f) => f.path !== 'src/lib/membership.ts' && /\/memberships`\)/.test(f.src));

/**
 * 逆引き index を読む式（`.../memberships`)` から 3 行）を切り出す。
 *
 * ファイル全体に `activeMembership` があるかを見るだけでは**ガードが素通りする**。
 * 実際、判定を戻して生の `snap.docs.map((d) => d.id)` にしても import が残るため緑のままだった
 * （今週何度も出た「ガード自身の穴」＝走査範囲が実物を見ていない形）。式そのものを見る。
 */
export function membershipExprs(src: string): string[] {
  const out: string[] = [];
  const re = /\/memberships`\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.push(src.slice(m.index).split('\n').slice(0, 3).join('\n'));
  }
  return out;
}

/**
 * index の snapshot から**生で**所属を取り出している形。
 * `owned`（所有クエリ）側の同型は正当なので、index 側の変数名に限定して見る。
 */
const RAW_EXTRACT = /\b(?:ms|s|snap)\.(?:docs\.map|forEach)\(|\b(?:ms|s|snap)\.empty\b/;

describe('逆引き index の読み手（定義のドリフト防止）', () => {
  it('走査対象が取れている（グロブ破綻の空振り防止）', () => {
    expect(READERS.length).toBeGreaterThan(5);
    expect(READERS.flatMap((f) => membershipExprs(f.src)).length).toBeGreaterThan(5);
  });

  it('★index を読む式で生の抽出をしない（membership.ts の判定を必ず通す）', () => {
    const offenders: string[] = [];
    for (const f of READERS) {
      for (const expr of membershipExprs(f.src)) {
        if (RAW_EXTRACT.test(expr)) offenders.push(`${f.path}: ${expr.split('\n')[1]?.trim() ?? ''}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('★ガード自身の判定が効いている（生の抽出を赤に、判定経由を緑にできる）', () => {
    const raw = 'getDocs(collection(db, `account_users/${uid}/memberships`))\n  .then((snap) => snap.docs.map((d) => d.id))\n';
    const viaHelper = 'getDocs(collection(db, `account_users/${uid}/memberships`))\n  .then((snap) => activeMembershipIds(snap.docs))\n';
    const ownedIsFine = 'getDocs(collection(db, `account_users/${uid}/memberships`))\n  .then((s) => activeMembershipIds(s.docs));\nconst ids = owned.docs.map((d) => d.id);\n';
    expect(RAW_EXTRACT.test(membershipExprs(raw)[0])).toBe(true);
    expect(RAW_EXTRACT.test(membershipExprs(viaHelper)[0])).toBe(false);
    expect(RAW_EXTRACT.test(membershipExprs(ownedIsFine)[0])).toBe(false);
  });

  it('★サーバ（CF）とクライアントで在籍の既定が一致している', () => {
    const cf = readFileSync(join(process.cwd(), 'functions/src/lib/workspaces.ts'), 'utf8');
    // CF 側: status 未設定は 'active'、それ以外は対象外
    expect(cf).toMatch(/status[^\n]*\?\?\s*'active'/);
    expect(cf).toMatch(/status !== 'active'/);
    // クライアント側: 同じ既定文字列を単一定数で持つ
    expect(ACTIVE_STATUS).toBe('active');
  });
});
