import { describe, it, expect } from 'vitest';
import {
  REQUIRED_PROFILE_FIELDS,
  isProfileFieldFilled,
  evaluateProfileCompletion,
} from '../../src/app/api/account/beta-profile-reward/completion';

// profile_complete 報酬の「全項目埋め」判定を単一ソース化した純ヘルパー（Day69）。
// beta-profile-reward の GET（診断）と POST（受領ガード）が同じ基準で判定することを保証する。

const FULL = {
  stageName: 'あや',
  staffRole: 'cast',
  gender: 'female',
  firstPerson: 'わたし',
  defaultTone: 'friendly',
  emojiLevel: 2,
};

describe('isProfileFieldFilled', () => {
  it('非空文字列は埋まり、空文字・空白のみは未', () => {
    expect(isProfileFieldFilled('A')).toBe(true);
    expect(isProfileFieldFilled('')).toBe(false);
    expect(isProfileFieldFilled('   ')).toBe(false);
  });
  it('undefined / null は未', () => {
    expect(isProfileFieldFilled(undefined)).toBe(false);
    expect(isProfileFieldFilled(null)).toBe(false);
  });
  it('非文字列（数値 0 / boolean）は値が存在すれば埋まり＝emojiLevel=0 を弾かない', () => {
    expect(isProfileFieldFilled(0)).toBe(true);
    expect(isProfileFieldFilled(3)).toBe(true);
    expect(isProfileFieldFilled(false)).toBe(true);
  });
});

describe('evaluateProfileCompletion', () => {
  it('全項目埋まり: allFilled=true・filledCount=6・firstMissing=null', () => {
    const r = evaluateProfileCompletion(FULL);
    expect(r.allFilled).toBe(true);
    expect(r.filledCount).toBe(REQUIRED_PROFILE_FIELDS.length);
    expect(r.requiredCount).toBe(6);
    expect(r.firstMissing).toBeNull();
    for (const k of REQUIRED_PROFILE_FIELDS) expect(r.filled[k]).toBe(true);
  });

  it('emojiLevel=0 でも全項目埋まり扱い（0 を未入力にしない回帰）', () => {
    expect(evaluateProfileCompletion({ ...FULL, emojiLevel: 0 }).allFilled).toBe(true);
  });

  it('一部未入力: allFilled=false・firstMissing は REQUIRED 順の先頭欠落', () => {
    // gender を空・firstPerson を undefined にする → 先頭欠落は gender
    const r = evaluateProfileCompletion({ ...FULL, gender: '  ', firstPerson: undefined });
    expect(r.allFilled).toBe(false);
    expect(r.filledCount).toBe(4);
    expect(r.firstMissing).toBe('gender');
    expect(r.filled.gender).toBe(false);
    expect(r.filled.firstPerson).toBe(false);
    expect(r.filled.stageName).toBe(true);
  });

  it('空オブジェクト: すべて未・firstMissing は先頭フィールド', () => {
    const r = evaluateProfileCompletion({});
    expect(r.allFilled).toBe(false);
    expect(r.filledCount).toBe(0);
    expect(r.firstMissing).toBe(REQUIRED_PROFILE_FIELDS[0]);
  });

  it('未知フィールドは判定に影響しない（必須6項目のみ見る）', () => {
    const r = evaluateProfileCompletion({ ...FULL, someExtra: '' });
    expect(r.allFilled).toBe(true);
  });
});
