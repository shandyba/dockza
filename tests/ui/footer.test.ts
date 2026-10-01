import { describe, it, expect } from 'vitest';
import { BACK, filteredHints } from '@ui/footer';

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
