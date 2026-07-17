import { describe, it, expect } from 'vitest';
import {
  resolveStoreHintKey,
  buildPlaybookInstruction,
  VOICE_RULES,
  NIGHT_WORK_BASE_PLAYBOOK,
  STORE_TYPE_HINTS,
  SCENE_ADDITIONAL_HINTS,
} from '../../src/lib/ai-knowledge/night-work-playbook';

// AI system プロンプトの中核（業種ルーティング＋プレイブック合成）の characterization。
// resolveStoreHintKey の優先順位は「キャバクラ→cabaret（club ではない）」等、判定順に依存する。
// 将来の並べ替えで業種が静かに誤ルーティングされると、注入されるプレイブックが丸ごと変わるため固定する。

describe('resolveStoreHintKey — 業種ルーティングの優先順位', () => {
  it('重複キーワードは具体的な業種を優先する（順序依存の固定）', () => {
    // 「キャバクラ」は キャバ と クラブ の両方を含むが cabaret 優先
    expect(resolveStoreHintKey('キャバクラ')).toBe('cabaret');
    // 「ホストクラブ」は host 優先（club ではない）
    expect(resolveStoreHintKey('ホストクラブ')).toBe('host');
    // 「ガールズバー」は girls_bar 優先（bar ではない）
    expect(resolveStoreHintKey('ガールズバー')).toBe('girls_bar');
    // 「会員制ラウンジ」は lounge 優先（club/会員制 ではない）
    expect(resolveStoreHintKey('会員制ラウンジ')).toBe('lounge');
  });

  it('単独キーワード・自由入力・英字を業種へ寄せる', () => {
    expect(resolveStoreHintKey('中小キャバ')).toBe('cabaret');
    expect(resolveStoreHintKey('高級ラウンジ')).toBe('lounge');
    expect(resolveStoreHintKey('会員制クラブ')).toBe('club');
    expect(resolveStoreHintKey('スナック')).toBe('snack');
    expect(resolveStoreHintKey('スポーツバー')).toBe('bar');
    expect(resolveStoreHintKey('ギャラ飲み')).toBe('gyara_nomi');
    expect(resolveStoreHintKey('パパ活')).toBe('papa_katsu');
    expect(resolveStoreHintKey('デリヘル')).toBe('fuzoku');
    expect(resolveStoreHintKey('girls bar')).toBe('girls_bar');
    expect(resolveStoreHintKey('HOST')).toBe('host');
  });

  it('未知・空・空白は null（プレイブック業種注入なし）', () => {
    expect(resolveStoreHintKey('メンズコンセプトカフェ')).toBeNull();
    expect(resolveStoreHintKey('カフェ')).toBeNull();
    expect(resolveStoreHintKey('')).toBeNull();
    expect(resolveStoreHintKey('   ')).toBeNull();
    expect(resolveStoreHintKey(null)).toBeNull();
    expect(resolveStoreHintKey(undefined)).toBeNull();
  });
});

describe('buildPlaybookInstruction — プレイブック合成', () => {
  it('VOICE_RULES を常に最上段へ置く', () => {
    const out = buildPlaybookInstruction({});
    expect(out.startsWith(VOICE_RULES)).toBe(true);
  });

  it('通常はフル、compact は要点版を注入する（差分がある）', () => {
    const full = buildPlaybookInstruction({ compact: false });
    const compact = buildPlaybookInstruction({ compact: true });
    expect(full).toContain(NIGHT_WORK_BASE_PLAYBOOK);
    expect(compact).not.toContain(NIGHT_WORK_BASE_PLAYBOOK);
    expect(compact).toContain('夜職営業の要点');
    // compact はフルより短い
    expect(compact.length).toBeLessThan(full.length);
  });

  it('storeType が既知ならその業種ヒントを追記する', () => {
    const out = buildPlaybookInstruction({ storeType: 'host' });
    expect(out).toContain(STORE_TYPE_HINTS.host!);
  });

  it('storeType が null なら業種ヒントを足さない', () => {
    const out = buildPlaybookInstruction({ storeType: null });
    // どの業種ヒントも含まれない
    for (const hint of Object.values(STORE_TYPE_HINTS)) {
      if (hint) expect(out).not.toContain(hint);
    }
  });

  it('既知の scene はシーンヒントを追記し、未知の scene は無視する', () => {
    const withScene = buildPlaybookInstruction({ scene: 'apology' });
    expect(withScene).toContain(SCENE_ADDITIONAL_HINTS.apology);
    const unknownScene = buildPlaybookInstruction({ scene: 'no_such_scene' });
    expect(unknownScene).toBe(buildPlaybookInstruction({}));
  });
});
