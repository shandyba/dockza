import { describe, it, expect } from 'vitest';
import { containerRelated } from '@ui/containers/container-related';
import { networkRelated } from '@ui/networks/network-related';
import { volumeRelated } from '@ui/volumes/volume-related';
import { endpoint, makeContainer, makeNetwork, makeVolume } from '../fixtures';

const byKey = (rows: { key: string }[]) => rows.map((r) => r.key);
const copyOf = (row: { copy: { key: string; text: string | null }[] }) =>
  Object.fromEntries(row.copy.map((o) => [o.key, o.text]));

describe('containerRelated', () => {
  it('a container outside any stack: just its image', () => {
    expect(byKey(containerRelated(makeContainer()))).toEqual(['image']);
  });

  it('a compose container: its stack, the service named, compose details to copy', () => {
    const c = makeContainer({
      labels: { 'com.docker.compose.project': 'dzlink' },
      compose: {
        project: 'dzlink',
        service: 'db',
        configFiles: ['/srv/dzlink/compose.yaml', '/srv/dzlink/override.yaml'],
        workingDir: '/srv/dzlink',
        dependsOn: [],
        oneoff: false,
      },
    });
    const [, stack] = containerRelated(c);
    expect(stack).toMatchObject({ label: 'stack', text: 'dzlink', note: '· service db' });
    expect(stack.ref).toEqual({ kind: 'stack', id: 'dzlink' });
    expect(copyOf(stack)).toEqual({
      n: 'dzlink',
      f: '/srv/dzlink/compose.yaml\n/srv/dzlink/override.yaml',
      w: '/srv/dzlink',
    });
  });

  it('a stack picked out by its default network: a link, but no compose details', () => {
    const [, stack] = containerRelated(makeContainer({ networks: [endpoint('legacy_default')] }));
    expect(stack.ref).toEqual({ kind: 'stack', id: 'legacy' });
    expect(stack.note).toBeUndefined();
    expect(copyOf(stack)).toEqual({ n: 'legacy', f: null, w: null });
  });
});

describe('volumeRelated / networkRelated', () => {
  it("a compose volume's stack, with its key in the project", () => {
    const [row] = volumeRelated(makeVolume('dzlink_data', { stack: 'dzlink', composeVolume: 'data' }));
    expect(row).toMatchObject({ label: 'stack', text: 'dzlink', note: '· volume data' });
    expect(row.ref).toEqual({ kind: 'stack', id: 'dzlink' });
  });

  it('an orphan: the project named, no link', () => {
    const [row] = volumeRelated(makeVolume('gone_cache', { stack: 'gone', orphaned: true }));
    expect(row).toMatchObject({ label: 'project', text: 'gone', note: 'has no containers', warn: true });
    expect(row.ref).toBeNull();
  });

  it('an anonymous volume: a plain row', () => {
    const [row] = volumeRelated(makeVolume('a'.repeat(64), { anonymous: true }));
    expect(row).toMatchObject({ label: 'origin', text: 'anonymous', ref: null });
  });

  it('a plain volume or network: nothing related', () => {
    expect(volumeRelated(makeVolume('plain'))).toEqual([]);
    expect(networkRelated(makeNetwork('bridge'))).toEqual([]);
  });

  it("a compose network's stack, with its key in the project", () => {
    const [row] = networkRelated(makeNetwork('dzlink_back', { stack: 'dzlink', composeNetwork: 'back' }));
    expect(row).toMatchObject({ label: 'stack', text: 'dzlink', note: '· network back' });
  });
});
