import { describe, it, expect } from 'vitest';
import type { ContainerInfo, MountInfo, VolumeInfo, VolumeUser } from '@models/docker';
import { stripTags } from '@utils/format';
import { formatUsedBy, volumeUsers, withUsers } from '@utils/volume-users';

function container(name: string, mounts: MountInfo[], extra: Partial<ContainerInfo> = {}): ContainerInfo {
  return {
    id: `${name}-id`,
    name,
    image: 'img',
    status: 'running',
    exitCode: 0,
    uptime: '',
    ports: [],
    networks: [],
    ip: '',
    mounts,
    env: [],
    restartPolicy: 'no',
    pids: 0,
    labels: {},
    ...extra,
  };
}

const vol = (name: string, destination: string, rw = true): MountInfo => ({
  type: 'volume',
  name,
  source: `/var/lib/docker/volumes/${name}/_data`,
  destination,
  mode: '',
  rw,
});

const volume = (name: string): VolumeInfo => ({
  name,
  driver: 'local',
  mountpoint: `/var/lib/docker/volumes/${name}/_data`,
  created: new Date(0),
  sizeMB: 0,
  labels: {},
  anonymous: false,
  users: [],
  inUse: false,
});

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

describe('formatUsedBy', () => {
  const user = (name: string, id = `${name}-id`): VolumeUser => ({
    id,
    name,
    status: 'running',
    exitCode: 0,
    destination: '/data',
    rw: true,
  });
  const plain = (s: string): string => stripTags(s);

  it('shows a dash when nothing uses the volume', () => {
    expect(plain(formatUsedBy([], 20))).toBe('—');
  });

  it('shows the first user with its status dot', () => {
    expect(plain(formatUsedBy([user('db-pr02')], 20))).toBe('● db-pr02');
  });

  it('counts the other containers, not their mounts', () => {
    const users = [user('web'), user('web'), user('worker'), user('cron')];
    expect(plain(formatUsedBy(users, 30))).toBe('● web +2');
  });

  it('fits the name so the cell stays within width - 1', () => {
    const cell = plain(formatUsedBy([user('a-very-long-container-name'), user('b')], 14));
    expect(cell).toBe('● a-very-… +1');
    expect(cell.length).toBeLessThanOrEqual(13);
  });
});
