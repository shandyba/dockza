import { describe, it, expect } from 'vitest';
import type Dockerode from 'dockerode';
import { toVolumeInfo } from '@docker/volumes';

function raw(overrides: Partial<Dockerode.VolumeInspectInfo> & { CreatedAt?: string } = {}) {
  return {
    Name: 'db-pr02_pgdata',
    Driver: 'local',
    Mountpoint: '/var/lib/docker/volumes/db-pr02_pgdata/_data',
    Labels: {},
    Scope: 'local',
    Options: null,
    ...overrides,
  } as Dockerode.VolumeInspectInfo;
}

describe('toVolumeInfo', () => {
  it('maps the basics and converts the size to MiB', () => {
    const info = toVolumeInfo(raw({ CreatedAt: '2026-09-30T08:51:21Z' }), 3 * 1024 * 1024);
    expect(info.name).toBe('db-pr02_pgdata');
    expect(info.driver).toBe('local');
    expect(info.mountpoint).toBe('/var/lib/docker/volumes/db-pr02_pgdata/_data');
    expect(info.created.toISOString()).toBe('2026-09-30T08:51:21.000Z');
    expect(info.sizeMB).toBe(3);
  });

  it('reports an unknown size (-1) or a missing date as zero', () => {
    const info = toVolumeInfo(raw(), -1);
    expect(info.sizeMB).toBe(0);
    expect(info.created.getTime()).toBe(0);
  });

  it('reads the compose project and volume key from labels', () => {
    const info = toVolumeInfo(
      raw({
        Labels: { 'com.docker.compose.project': 'db-pr02', 'com.docker.compose.volume': 'pgdata' },
      }),
      0,
    );
    expect(info.stack).toBe('db-pr02');
    expect(info.composeVolume).toBe('pgdata');
    expect(info.anonymous).toBe(false);
  });

  it('flags an anonymous volume, and tolerates null labels', () => {
    const hash = 'a'.repeat(64);
    const labelled = toVolumeInfo(raw({ Name: 'x', Labels: { 'com.docker.volume.anonymous': '' } }), 0);
    const unlabelled = toVolumeInfo(raw({ Name: hash, Labels: null as any }), 0);
    expect(labelled.anonymous).toBe(true);
    expect(unlabelled.anonymous).toBe(true);
    expect(unlabelled.labels).toEqual({});
    expect(unlabelled.stack).toBeUndefined();
  });

  it('starts with no users: App joins them in', () => {
    const info = toVolumeInfo(raw(), 0);
    expect(info.users).toEqual([]);
    expect(info.inUse).toBe(false);
  });
});
