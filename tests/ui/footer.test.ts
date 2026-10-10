import { describe, it, expect } from 'vitest';
import { BACK, filteredHints, markedHints } from '@ui/footer';

const keys = (hints: Array<{ key: string }>) => hints.map((h) => h.key);

describe('filteredHints', () => {
  it('puts Esc right after an existing `/`', () => {
    const hints = filteredHints('images');
    const at = keys(hints).indexOf('/');
    expect(at).toBeGreaterThan(-1);
    expect(hints[at + 1]).toEqual({ key: 'Esc', verb: 'unfilter' });
    expect(keys(hints).filter((k) => k === '/')).toHaveLength(1);
  });

  it('adds `/` and Esc before back/fwd when the context has no `/`', () => {
    const hints = filteredHints('detail');
    const at = keys(hints).indexOf('/');
    expect(hints[at + 1]).toEqual({ key: 'Esc', verb: 'unfilter' });
    expect(hints[at + 2]).toBe(BACK);
  });
});

describe('markedHints', () => {
  const pairs = (hints: Array<{ key: string; verb: string }>) => hints.map((h) => `${h.key} ${h.verb}`);

  it('says how many d takes, and adds a and Esc right after Space', () => {
    expect(pairs(markedHints('images', 3, false)).slice(2, 7)).toEqual([
      'd delete 3',
      'Space mark',
      'a all',
      'Esc unmark',
      '/ filter',
    ]);
  });

  it('leaves Esc to the filter while one is on', () => {
    const hints = pairs(markedHints(filteredHints('images'), 3, true));
    expect(hints).toContain('Esc unfilter');
    expect(hints).not.toContain('Esc unmark');
  });
});
