import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toContainerInfo } from '@docker/containers';
import type Dockerode from 'dockerode';

function rawContainer(overrides: Partial<Dockerode.ContainerInfo> = {}): Dockerode.ContainerInfo {
  return {
    Id: 'abc123',
    Names: ['/test-container'],
    Image: 'nginx:latest',
    ImageID: 'sha256:img',
    Command: '',
    Created: 0,
    Ports: [],
    Labels: {},
    State: 'running',
    Status: 'Up 5 minutes',
    HostConfig: { NetworkMode: 'default' },
    NetworkSettings: { Networks: {} },
    Mounts: [],
    ...overrides,
  } as Dockerode.ContainerInfo;
}

function inspected(overrides: {
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  pid?: number;
  env?: string[];
  restart?: string;
}): Dockerode.ContainerInspectInfo {
  return {
    State: {
      StartedAt: overrides.startedAt ?? '0001-01-01T00:00:00Z',
      FinishedAt: overrides.finishedAt ?? '0001-01-01T00:00:00Z',
      ExitCode: overrides.exitCode ?? 0,
      Pid: overrides.pid ?? 0,
    },
    Config: { Env: overrides.env ?? [] },
    HostConfig: { RestartPolicy: { Name: overrides.restart ?? 'no' } },
  } as any;
}

describe('toContainerInfo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('strips the leading slash from container name', () => {
    const info = toContainerInfo(rawContainer({ Names: ['/my-app'] }), null);
    expect(info.name).toBe('my-app');
  });

  it('falls back to raw.Id when Names is empty', () => {
    const info = toContainerInfo(rawContainer({ Names: [], Id: 'deadbeef' }), null);
    expect(info.name).toBe('deadbeef');
  });

  it('keeps valid statuses as-is', () => {
    const info = toContainerInfo(rawContainer({ State: 'paused' }), null);
    expect(info.status).toBe('paused');
  });

  it('coerces unknown statuses to "exited"', () => {
    const info = toContainerInfo(rawContainer({ State: 'unknown-future-state' }), null);
    expect(info.status).toBe('exited');
  });

  it('uses raw.Status as uptime when not inspected', () => {
    const info = toContainerInfo(rawContainer({ Status: 'Up 5 minutes' }), null);
    expect(info.uptime).toBe('Up 5 minutes');
  });

  it('derives uptime from StartedAt when running and inspected', () => {
    const fiveMinutesAgo = new Date('2026-05-14T11:55:00Z').toISOString();
    const info = toContainerInfo(
      rawContainer({ State: 'running' }),
      inspected({ startedAt: fiveMinutesAgo }),
    );
    expect(info.uptime).toBe('5m 0s');
  });

  it('derives uptime from FinishedAt when exited', () => {
    const oneHourAgo = new Date('2026-05-14T11:00:00Z').toISOString();
    const info = toContainerInfo(
      rawContainer({ State: 'exited' }),
      inspected({ finishedAt: oneHourAgo, exitCode: 137 }),
    );
    expect(info.uptime).toMatch(/hour ago/);
    expect(info.exitCode).toBe(137);
  });

  it('falls back to raw.Status when FinishedAt is the epoch-zero sentinel', () => {
    const info = toContainerInfo(
      rawContainer({ State: 'exited', Status: 'Exited (0) just now' }),
      inspected({ finishedAt: '0001-01-01T00:00:00Z' }),
    );
    expect(info.uptime).toBe('Exited (0) just now');
  });

  it('falls back to raw.Status when StartedAt is the epoch-zero sentinel', () => {
    const info = toContainerInfo(
      rawContainer({ State: 'running', Status: 'Up' }),
      inspected({ startedAt: '0001-01-01T00:00:00Z' }),
    );
    expect(info.uptime).toBe('Up');
  });

  it('maps a published port with its address and both sides', () => {
    const info = toContainerInfo(
      rawContainer({
        Ports: [{ IP: '0.0.0.0', PublicPort: 8080, PrivatePort: 80, Type: 'tcp' }],
      }),
      null,
    );
    expect(info.ports).toEqual([{ ip: '0.0.0.0', publicPort: 8080, privatePort: 80, type: 'tcp' }]);
  });

  it('maps an internal-only port without address or public side', () => {
    const info = toContainerInfo(rawContainer({ Ports: [{ PrivatePort: 3000, Type: 'tcp' } as any] }), null);
    expect(info.ports).toEqual([{ privatePort: 3000, type: 'tcp' }]);
  });

  it('treats a null Ports payload as no ports', () => {
    // The daemon sends Ports: null (not []) for containers that publish nothing.
    const info = toContainerInfo(rawContainer({ Ports: null as any }), null);
    expect(info.ports).toEqual([]);
  });

  it('maps each network endpoint by name, with its address and gateway', () => {
    const info = toContainerInfo(
      rawContainer({
        NetworkSettings: {
          Networks: {
            bridge: { IPAddress: '172.17.0.2', Gateway: '172.17.0.1' },
          } as any,
        },
      }),
      null,
    );
    expect(info.networks).toEqual([{ name: 'bridge', ip: '172.17.0.2', gateway: '172.17.0.1', aliases: [] }]);
  });

  it("takes the DNS names from inspect, without the container's short ID", () => {
    const listed = { 'db-pr02_default': { IPAddress: '', Gateway: '', Aliases: null, DNSNames: null } };
    const fromInspect = {
      'db-pr02_default': { Aliases: ['db-pr02', 'db'], DNSNames: ['db-pr02', 'db', 'b5322c040ce6'] },
    };
    const info = toContainerInfo(
      rawContainer({ Id: 'b5322c040ce6aaaaaaaa', NetworkSettings: { Networks: listed } as any }),
      { ...inspected({}), NetworkSettings: { Networks: fromInspect } } as any,
    );
    expect(info.networks[0].aliases).toEqual(['db-pr02', 'db']);
    expect(info.networks[0].ip).toBe(''); // stopped
  });

  it('falls back to Aliases when the daemon has no DNSNames', () => {
    const info = toContainerInfo(rawContainer({ NetworkSettings: { Networks: { n: {} } } as any }), {
      ...inspected({}),
      NetworkSettings: { Networks: { n: { Aliases: ['web'] } } },
    } as any);
    expect(info.networks[0].aliases).toEqual(['web']);
  });

  it('sorts networks by name', () => {
    const info = toContainerInfo(
      rawContainer({ NetworkSettings: { Networks: { zeta: {}, alpha: {} } } as any }),
      null,
    );
    expect(info.networks.map((n) => n.name)).toEqual(['alpha', 'zeta']);
  });

  it('has no networks for an empty or null Networks map', () => {
    expect(toContainerInfo(rawContainer({ NetworkSettings: { Networks: {} } }), null).networks).toEqual([]);
    const info = toContainerInfo(rawContainer({ NetworkSettings: { Networks: null } as any }), null);
    expect(info.networks).toEqual([]);
  });

  it('keeps the exact image ID, and the name it was created from from inspect', () => {
    // The list replaces `Image` with an ID once the name resolves to another image.
    const info = toContainerInfo(rawContainer({ Image: 'sha256:4ef4dbc939d6', ImageID: 'sha256:4ef4' }), {
      ...inspected({}),
      Config: { Env: [], Image: 'postgres:18' },
    } as any);
    expect(info.image).toBe('sha256:4ef4dbc939d6');
    expect(info.imageId).toBe('sha256:4ef4');
    expect(info.imageName).toBe('postgres:18');
  });

  it('names the image as listed when there is no inspect', () => {
    expect(toContainerInfo(rawContainer({ Image: 'nginx:latest' }), null).imageName).toBe('nginx:latest');
  });

  it("reads compose's labels", () => {
    const info = toContainerInfo(
      rawContainer({
        Labels: {
          'com.docker.compose.project': 'db-pr02',
          'com.docker.compose.service': 'api',
          'com.docker.compose.depends_on': 'db:service_healthy:true',
        },
      }),
      null,
    );
    expect(info.compose).toMatchObject({ project: 'db-pr02', service: 'api', dependsOn: ['db'] });
    expect(toContainerInfo(rawContainer(), null).compose).toBeUndefined();
  });

  it('reads a shared network stack from the network mode', () => {
    const shared = toContainerInfo(rawContainer({ HostConfig: { NetworkMode: 'container:abc123' } }), null);
    expect(shared.networkMode).toEqual({ container: 'abc123' });
    expect(toContainerInfo(rawContainer(), null).networkMode).toBeUndefined();
  });

  it('reads volumes-from targets from inspect, without their :ro / :rw', () => {
    const info = toContainerInfo(rawContainer(), {
      ...inspected({}),
      HostConfig: { RestartPolicy: { Name: 'no' }, VolumesFrom: ['data', 'store:ro'] },
    } as any);
    expect(info.volumesFrom).toEqual(['data', 'store']);
    expect(toContainerInfo(rawContainer(), inspected({})).volumesFrom).toEqual([]);
  });

  it('falls back to raw.Id when Names is null', () => {
    const info = toContainerInfo(rawContainer({ Names: null as any, Id: 'deadbeef' }), null);
    expect(info.name).toBe('deadbeef');
  });

  it('maps mounts', () => {
    const info = toContainerInfo(
      rawContainer({
        Mounts: [
          {
            Source: '/host/data',
            Destination: '/data',
            Mode: 'rw',
            RW: true,
            Type: 'bind',
          } as any,
        ],
      }),
      null,
    );
    expect(info.mounts).toEqual([
      { source: '/host/data', destination: '/data', mode: 'rw', rw: true, type: 'bind' },
    ]);
  });

  it('keeps the volume name and driver of a volume mount', () => {
    const info = toContainerInfo(
      rawContainer({
        Mounts: [
          {
            Type: 'volume',
            Name: 'db-pr02_pgdata',
            Driver: 'local',
            Source: '/var/lib/docker/volumes/db-pr02_pgdata/_data',
            Destination: '/var/lib/postgresql',
            Mode: 'rw',
            RW: true,
          } as any,
        ],
      }),
      null,
    );
    expect(info.mounts[0]).toMatchObject({ type: 'volume', name: 'db-pr02_pgdata', driver: 'local' });
  });

  it("prefers inspect's mounts: the list leaves an anonymous volume's Source empty", () => {
    const listed = { Type: 'volume', Name: 'abc', Source: '', Destination: '/data', Mode: '', RW: true };
    const inspectedMount = { ...listed, Source: '/var/lib/docker/volumes/abc/_data' };
    const info = toContainerInfo(rawContainer({ Mounts: [listed as any] }), {
      ...inspected({}),
      Mounts: [inspectedMount],
    } as any);
    expect(info.mounts[0].source).toBe('/var/lib/docker/volumes/abc/_data');
  });

  it('sorts mounts by destination, so polls do not reshuffle them', () => {
    const at = (d: string) => ({ Type: 'bind', Source: `/h${d}`, Destination: d, Mode: '', RW: true }) as any;
    const info = toContainerInfo(rawContainer({ Mounts: [at('/var'), at('/app'), at('/etc')] }), null);
    expect(info.mounts.map((m) => m.destination)).toEqual(['/app', '/etc', '/var']);
  });

  it('tolerates a null Mounts payload', () => {
    const info = toContainerInfo(rawContainer({ Mounts: null as any }), null);
    expect(info.mounts).toEqual([]);
  });

  it('pulls env, restartPolicy, and pids from inspect when present', () => {
    const info = toContainerInfo(
      rawContainer({ State: 'running' }),
      inspected({
        startedAt: '2026-05-14T11:55:00Z',
        env: ['FOO=bar', 'BAZ=qux'],
        restart: 'unless-stopped',
        pid: 4242,
      }),
    );
    expect(info.env).toEqual(['FOO=bar', 'BAZ=qux']);
    expect(info.restartPolicy).toBe('unless-stopped');
    expect(info.pids).toBe(4242);
  });

  it('defaults env/restartPolicy/pids when inspect is null', () => {
    const info = toContainerInfo(rawContainer(), null);
    expect(info.env).toEqual([]);
    expect(info.restartPolicy).toBe('no');
    expect(info.pids).toBe(0);
  });

  it('exposes container labels from the raw payload', () => {
    const info = toContainerInfo(
      rawContainer({
        Labels: {
          'com.docker.compose.project': 'alphie',
          'com.docker.compose.service': 'web',
        },
      }),
      null,
    );
    expect(info.labels).toEqual({
      'com.docker.compose.project': 'alphie',
      'com.docker.compose.service': 'web',
    });
  });

  it('defaults labels to an empty object when raw.Labels is missing', () => {
    const info = toContainerInfo(
      rawContainer({ Labels: undefined as unknown as Record<string, string> }),
      null,
    );
    expect(info.labels).toEqual({});
  });
});
