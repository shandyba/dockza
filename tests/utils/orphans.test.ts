import { describe, it, expect } from 'vitest';
import { liveProjects, markDangling, markOrphans, unusedLabel } from '@utils/orphans';
import { groupIntoStacks } from '@utils/stacks';
import { endpoint, makeContainer, makeNetwork, makeVolume } from '../fixtures';

const live = liveProjects(
  groupIntoStacks([
    makeContainer({ id: 'a', status: 'exited', labels: { 'com.docker.compose.project': 'dzlink' } }),
    // No label: grouped by its `<project>_default` network.
    makeContainer({ id: 'b', networks: [endpoint('legacy_default')] }),
    makeContainer({ id: 'c' }),
  ]),
);

describe('liveProjects', () => {
  it('names every stack with containers, stopped ones included, but not the catch-all', () => {
    expect([...live].sort()).toEqual(['dzlink', 'legacy']);
  });
});

describe('markOrphans', () => {
  it('marks an unused item whose project has no containers left', () => {
    const [gone] = markOrphans([makeVolume('dzlink-gone_cache', { stack: 'dzlink-gone' })], live);
    expect(gone.orphaned).toBe(true);
  });

  it('leaves an item of a live project, an item in use, and one compose did not create', () => {
    const items = markOrphans(
      [
        makeVolume('dzlink_data', { stack: 'dzlink' }),
        makeVolume('legacy_data', { stack: 'legacy' }),
        makeVolume('busy', { stack: 'dzlink-gone', inUse: true }),
        makeVolume('plain'),
      ],
      live,
    );
    for (const v of items) expect(v.orphaned).toBeUndefined();
  });

  it('works for networks too, and clears a mark that no longer holds', () => {
    const net = makeNetwork('dzlink_back', { stack: 'dzlink', orphaned: true });
    const [marked] = markOrphans([net], live);
    expect(marked.orphaned).toBeUndefined();
    expect(net.orphaned).toBe(true);
  });
});

describe('markDangling', () => {
  it('marks an anonymous volume no container mounts', () => {
    const [loose] = markDangling([makeVolume('a'.repeat(64), { anonymous: true })]);
    expect(loose.dangling).toBe(true);
  });

  it('leaves an anonymous volume in use, a named one, and an orphan', () => {
    const items = markDangling([
      makeVolume('b'.repeat(64), { anonymous: true, inUse: true }),
      makeVolume('plain'),
      makeVolume('dzlink-gone_cache', { anonymous: true, stack: 'dzlink-gone', orphaned: true }),
    ]);
    for (const v of items) expect(v.dangling).toBeUndefined();
  });

  it('clears a mark that no longer holds', () => {
    const vol = makeVolume('c'.repeat(64), { anonymous: true, inUse: true, dangling: true });
    const [marked] = markDangling([vol]);
    expect(marked.dangling).toBeUndefined();
    expect(vol.dangling).toBe(true);
  });
});

describe('unusedLabel', () => {
  it('names an orphan, then a dangling volume, and calls the rest unused', () => {
    expect(unusedLabel({ orphaned: true })).toBe('○ orphaned');
    expect(unusedLabel({ dangling: true })).toBe('○ dangling');
    expect(unusedLabel({})).toBe('○ unused');
  });
});
