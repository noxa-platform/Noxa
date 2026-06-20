import { describe, it, expect } from 'vitest';
import { resolveVisibility, VISIBILITY } from '../../src/lib/visibility';

describe('resolveVisibility（旧published互換）', () => {
  it('visibility があればそれを返す', () => {
    expect(resolveVisibility({ visibility: 'unlisted', published: false })).toBe('unlisted');
  });
  it('visibility 無し & published=true は public', () => {
    expect(resolveVisibility({ published: true })).toBe('public');
  });
  it('visibility 無し & published=false は private', () => {
    expect(resolveVisibility({ published: false })).toBe('private');
  });
  it('VISIBILITY は3値', () => {
    expect([...VISIBILITY]).toEqual(['public', 'unlisted', 'private']);
  });
});
