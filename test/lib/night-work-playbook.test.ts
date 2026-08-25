import { describe, it, expect } from 'vitest';
import {
  resolveStoreHintKey,
  buildPlaybookInstruction,
  VOICE_RULES,
  VOICE_RULES_COMPACT,
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
  it('文体ルールを常に最上段へ置く（通常はフル版）', () => {
    const out = buildPlaybookInstruction({});
    expect(out.startsWith(VOICE_RULES)).toBe(true);
  });

  // 2026-08-25 原価圧縮: compact を渡すのは chat と insights-narrative の 2 経路で、
  // どちらも「利用者本人への解説・助言」が主目的。chat の SYSTEM_PROMPT 自身が
  // 「この文体ルールの対象は顧客へ送る文面であって解説には適用しない」と書いており、
  // フル版 1,522 字を入れてから否定している状態だった。
  describe('compact 経路の文体ルール（原価圧縮）', () => {
    it('compact は短縮版を最上段に置く（フル版は入れない）', () => {
      const out = buildPlaybookInstruction({ compact: true });
      expect(out.startsWith(VOICE_RULES_COMPACT)).toBe(true);
      expect(out).not.toContain(VOICE_RULES);
    });

    it('短縮版はフル版より十分短い（半分以下）', () => {
      expect(VOICE_RULES_COMPACT.length).toBeLessThan(VOICE_RULES.length / 2);
    });

    // 「短くした結果、効くルールまで落ちた」を防ぐ。
    // chat は「LINE 文面を書いて」と頼まれる経路でもあるので、丸ごと外してはいない
    it.each([
      ['禁止クリシェ', '胸が締め付けられる'],
      ['禁止クリシェ', 'かけがえのない'],
      ['括弧書きの禁止', '括弧書き'],
      ['改行の指示', '改行'],
      ['一人称の指定', '一人称'],
      ['読点の上限', '読点'],
    ])('短縮版でも %s が残っている（%s）', (_label, needle) => {
      expect(VOICE_RULES_COMPACT).toContain(needle);
    });

    it('文面生成が本業の経路（compact なし）はフル版のまま', () => {
      const full = buildPlaybookInstruction({ compact: false });
      expect(full).toContain(VOICE_RULES);
      expect(full).not.toContain(VOICE_RULES_COMPACT);
    });

    it('compact 全体がフルより 1000 字以上短い（圧縮が実際に効いている）', () => {
      const full = buildPlaybookInstruction({ compact: false });
      const compact = buildPlaybookInstruction({ compact: true });
      expect(full.length - compact.length).toBeGreaterThan(1000);
    });
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

  // Day95-夜: scene / storeType はクライアント入力・workspace doc 由来の生文字列で、
  // ここが全 AI route（message / reply / chat）の合流点。素の索引はプロトタイプまで
  // 解決するため 'constructor' 等で Object 関数がプレイブックに混入していた。
  it('scene / storeType がプロトタイプ由来のキー（constructor 等）でも関数が混入しない', () => {
    const base = buildPlaybookInstruction({});
    for (const evil of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
      const byScene = buildPlaybookInstruction({ scene: evil });
      expect(byScene).not.toContain('native code');
      expect(byScene).toBe(base);
      const byStore = buildPlaybookInstruction({ storeType: evil as never });
      expect(byStore).not.toContain('native code');
      expect(byStore).toBe(base);
    }
  });
});
