import { describe, it, expect } from 'vitest';
import type { ContainerInfo, MountInfo } from '@models/docker';
import { volumeUsers, withUsers } from '@utils/volume-users';
import { makeContainer, makeVolume } from '../fixtures';

function container(name: string, mounts: MountInfo[], extra: Partial<ContainerInfo> = {}): ContainerInfo {
  return makeContainer({ id: `${name}-id`, name, mounts, ...extra });
}

const vol = (name: string, destination: string, rw = true): MountInfo => ({
  type: 'volume',
  name,
  source: `/var/lib/docker/volumes/${name}/_data`,
  destination,
  mode: '',
  rw,
});

const volume = (name: string) => makeVolume(name);

describe('volumeUsers', () => {
  it('lists every container mounting a volume, with where and how', () => {
    const users = volumeUsers([
      container('db', [vol('pgdata', '/var/lib/postgresql')], { exitCode: 3, status: 'exited' }),
    ]);
    expect(users.get('pgdata')).toEqual([
      {
        id: 'db-id',
        name: 'db',
        status: 'exited',
        exitCode: 3,
        destination: '/var/lib/postgresql',
        rw: true,
      },
    ]);
  });

  it('ignores binds, tmpfs and nameless mounts', () => {
    const users = volumeUsers([
      container('web', [
        { type: 'bind', source: '/host', destination: '/src', mode: 'rw', rw: true },
        { type: 'tmpfs', source: '', destination: '/tmp', mode: '', rw: true },
        { type: 'volume', source: '/x', destination: '/x', mode: '', rw: true },
      ]),
    ]);
    expect(users.size).toBe(0);
  });

  it('puts running users first, then sorts by name and destination', () => {
    const users = volumeUsers([
      container('b-stopped', [vol('shared', '/a')], { status: 'exited' }),
      container('z-running', [vol('shared', '/b')]),
      container('a-running', [vol('shared', '/d'), vol('shared', '/c', false)]),
    ]);
    expect(users.get('shared')?.map((u) => `${u.name}:${u.destination}`)).toEqual([
      'a-running:/c',
      'a-running:/d',
      'z-running:/b',
      'b-stopped:/a',
    ]);
  });
});

describe('withUsers', () => {
  it('joins users in and derives inUse from them', () => {
    const [used, unused] = withUsers(
      [volume('pgdata'), volume('orphan')],
      [container('db', [vol('pgdata', '/var/lib/postgresql')])],
    );
    expect(used.inUse).toBe(true);
    expect(used.users.map((u) => u.name)).toEqual(['db']);
    expect(unused.inUse).toBe(false);
    expect(unused.users).toEqual([]);
  });

  it('does not modify the volumes it was given', () => {
    const volumes = [volume('pgdata')];
    withUsers(volumes, [container('db', [vol('pgdata', '/x')])]);
    expect(volumes[0].users).toEqual([]);
    expect(volumes[0].inUse).toBe(false);
  });
});
