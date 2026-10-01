import { describe, it, expect } from 'vitest';
import type { MountInfo } from '@models/docker';
import { anonymousVolumes, hostPath, isAnonymousVolume, mountOrigin, mountSpec } from '@utils/mounts';

const HASH = 'a23bf7e5f7c1f068d35f3af5ba7c5d180b27059f025023becd466e90d20d9537';

function mount(extra: Partial<MountInfo>): MountInfo {
  return { type: 'bind', source: '', destination: '/data', mode: '', rw: true, ...extra };
}

describe('isAnonymousVolume', () => {
  it('trusts the anonymous label, whose value is empty', () => {
    expect(isAnonymousVolume('cache', { 'com.docker.volume.anonymous': '' })).toBe(true);
  });

  it('falls back to the generated 64-hex name', () => {
    expect(isAnonymousVolume(HASH)).toBe(true);
    expect(isAnonymousVolume(HASH, {})).toBe(true);
  });

  it('treats any other name as named', () => {
    expect(isAnonymousVolume('db-pr02_pgdata', { 'com.docker.compose.project': 'db-pr02' })).toBe(false);
    expect(isAnonymousVolume(HASH.slice(1))).toBe(false);
    expect(isAnonymousVolume(HASH.toUpperCase())).toBe(false);
  });
});

describe('hostPath', () => {
  it("strips Docker Desktop's /host_mnt prefix", () => {
    expect(hostPath('/host_mnt/private/tmp/db-pr02/sql')).toBe('/private/tmp/db-pr02/sql');
    expect(hostPath('/host_mnt')).toBe('/');
  });

  it('leaves every other path alone', () => {
    expect(hostPath('/home/me/project')).toBe('/home/me/project');
    expect(hostPath('/host_mnts/x')).toBe('/host_mnts/x');
    expect(hostPath('')).toBe('');
  });
});

describe('mountOrigin', () => {
  it('names the volume, not its daemon-side path', () => {
    const m = mount({ type: 'volume', name: 'db-pr02_pgdata', source: '/var/lib/docker/volumes/x/_data' });
    expect(mountOrigin(m)).toBe('db-pr02_pgdata');
  });

  it('shows a bind as its host path', () => {
    expect(mountOrigin(mount({ source: '/host_mnt/Users/me/app' }))).toBe('/Users/me/app');
  });

  it('falls back to the type when there is no source', () => {
    expect(mountOrigin(mount({ type: 'tmpfs' }))).toBe('tmpfs');
  });
});

describe('mountSpec', () => {
  it('writes a volume as name:dest', () => {
    expect(mountSpec(mount({ type: 'volume', name: 'pgdata', destination: '/var/lib/postgresql' }))).toBe(
      'pgdata:/var/lib/postgresql',
    );
  });

  it('writes a bind with its host path, and :ro when read-only', () => {
    expect(mountSpec(mount({ source: '/host_mnt/private/tmp/sql', destination: '/sql', rw: false }))).toBe(
      '/private/tmp/sql:/sql:ro',
    );
  });

  it('has no -v form for tmpfs or a nameless volume', () => {
    expect(mountSpec(mount({ type: 'tmpfs' }))).toBeNull();
    expect(mountSpec(mount({ type: 'volume', source: '/x' }))).toBeNull();
  });
});

describe('anonymousVolumes', () => {
  const ANON = 'f'.repeat(64);
  const m = (type: MountInfo['type'], name?: string): MountInfo => ({
    type,
    ...(name ? { name } : {}),
    source: '/src',
    destination: '/dst',
    mode: '',
    rw: true,
  });

  it('lists the anonymous volumes they mount, once each', () => {
    const a = { mounts: [m('volume', ANON), m('volume', 'named'), m('bind')] };
    const b = { mounts: [m('volume', ANON)] };
    expect(anonymousVolumes([a, b])).toEqual([ANON]);
  });

  it('is empty with named volumes and binds only', () => {
    expect(anonymousVolumes([{ mounts: [m('volume', 'named'), m('bind')] }])).toEqual([]);
  });
});
