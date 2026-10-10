import { describe, it, expect } from 'vitest';
import {
  cleanupDialog,
  nameList,
  plural,
  removeEach,
  removeMarkedDialog,
  type BulkTarget,
  type Cleanup,
} from '@ui/bulk-actions';

interface Vol {
  name: string;
  mb: number;
  kind: 'dangling' | 'orphaned' | 'named';
}

const vol = (name: string, kind: Vol['kind'], mb = 0): Vol => ({ name, kind, mb });

function target(fail: string[] = []): BulkTarget<Vol> & { removed: string[] } {
  const removed: string[] = [];
  return {
    noun: 'volume',
    nameOf: (v) => v.name,
    remove: async (v) => {
      if (fail.includes(v.name)) throw new Error(`Failed to remove volume ${v.name}: in use`);
      removed.push(v.name);
    },
    sizeMB: (v) => v.mb,
    removed,
  };
}

const CLEANUPS: Cleanup<Vol>[] = [
  { key: 'd', label: 'Dangling', detail: 'anonymous', matches: (v) => v.kind === 'dangling' },
  { key: 'o', label: 'Orphaned', detail: 'project gone', matches: (v) => v.kind === 'orphaned' },
  { key: 'u', label: 'All unused', detail: 'everything', matches: () => true },
];

describe('plural and nameList', () => {
  it('counts', () => {
    expect(plural(1, 'volume')).toBe('1 volume');
    expect(plural(0, 'volume')).toBe('0 volumes');
    expect(plural(3, 'volume')).toBe('3 volumes');
  });

  it('names a few, then says how many more', () => {
    expect(nameList(['a'])).toBe('a');
    expect(nameList(['a', 'b'])).toBe('a and b');
    expect(nameList(['a', 'b', 'c'])).toBe('a, b and c');
    expect(nameList(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c and 2 more');
  });
});

describe('removeEach', () => {
  it('removes every one, in order', async () => {
    const t = target();
    await removeEach(t, [vol('a', 'named'), vol('b', 'named')]);
    expect(t.removed).toEqual(['a', 'b']);
  });

  it('carries on past a failure, then names every failure with the first reason', async () => {
    const t = target(['b', 'c']);
    await expect(removeEach(t, [vol('a', 'named'), vol('b', 'named'), vol('c', 'named')])).rejects.toThrow(
      "Removed 1 of 3 volumes; couldn't remove b and c — Failed to remove volume b: in use",
    );
    expect(t.removed).toEqual(['a']);
  });
});

describe('removeMarkedDialog', () => {
  it('names what goes, and says what the filter hides and what stays', () => {
    const d = removeMarkedDialog(target(), [vol('a', 'named'), vol('b', 'named')], { blocked: 1, hidden: 1 });
    expect(d.title).toBe('Remove 2 volumes?');
    expect(d.message).toBe(
      "a and b will be permanently deleted. 1 of them is hidden by the filter. 1 more marked can't be deleted and stay marked.",
    );
    expect(d.choices.map((c) => [c.key, c.pending, c.done])).toEqual([
      ['y', 'Removing 2 volumes…', 'Removed 2 volumes'],
    ]);
  });

  it('says nothing more when everything marked is shown and may go', () => {
    const d = removeMarkedDialog(target(), [vol('a', 'named')], { blocked: 0, hidden: 0 });
    expect(d.title).toBe('Remove 1 volume?');
    expect(d.message).toBe('a will be permanently deleted.');
  });
});

describe('cleanupDialog', () => {
  const pool = [vol('x1', 'dangling', 82), vol('x2', 'dangling', 1024), vol('p_data', 'named', 30)];

  it('offers each kind with its count and size, aligned, and greys out an empty one', () => {
    const d = cleanupDialog(target(), CLEANUPS, pool);
    expect(d.title).toBe('Clean up volumes?');
    expect(d.message).toBe('Deleted for good; nothing in use is touched.');
    const [dangling, orphaned, unused] = d.choices;
    expect(dangling.detail).toBe('2 volumes · 1.1 GiB   anonymous');
    expect(orphaned.disabled).toBe('none');
    expect(orphaned.detail).toBe('0 volumes ·       —   project gone');
    expect(unused.detail).toBe('3 volumes · 1.1 GiB   everything');
    expect(d.choices.every((c) => c.danger)).toBe(true);
  });

  it('deletes exactly the kind picked', async () => {
    const t = target();
    const d = cleanupDialog(t, CLEANUPS, pool);
    await d.choices[0].run();
    expect(t.removed).toEqual(['x1', 'x2']);
  });

  it('says when the filter narrowed what it looks at', () => {
    const d = cleanupDialog(target(), CLEANUPS, pool, 5);
    expect(d.message).toBe('Only among the 5 the filter shows. Deleted for good; nothing in use is touched.');
  });

  it('leaves the size out when the list knows none', () => {
    const t = { ...target(), sizeMB: undefined };
    const d = cleanupDialog(t, CLEANUPS, pool);
    expect(d.choices[0].detail).toBe('2 volumes   anonymous');
  });
});
