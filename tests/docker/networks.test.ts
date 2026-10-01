import { describe, it, expect } from 'vitest';
import { toNetworkInfo } from '@docker/networks';
import type Dockerode from 'dockerode';

function rawNetwork(overrides: Partial<Dockerode.NetworkInspectInfo> = {}): Dockerode.NetworkInspectInfo {
  return {
    Name: 'my-network',
    Id: 'a1b2c3d4e5f60718293a4b5c6d7e8f900112233445566778899aabbccddeeff0',
    Created: '2026-05-14T12:00:00.000Z',
    Scope: 'local',
    Driver: 'bridge',
    EnableIPv6: false,
    Internal: false,
    Attachable: false,
    Ingress: false,
    ConfigOnly: false,
    ...overrides,
  } as Dockerode.NetworkInspectInfo;
}

describe('toNetworkInfo', () => {
  it('maps the core identity fields', () => {
    const info = toNetworkInfo(rawNetwork({ Id: 'net-id', Name: 'app_default' }));
    expect(info.id).toBe('net-id');
    expect(info.name).toBe('app_default');
  });

  it('maps driver and scope', () => {
    const info = toNetworkInfo(rawNetwork({ Driver: 'overlay', Scope: 'swarm' }));
    expect(info.driver).toBe('overlay');
    expect(info.scope).toBe('swarm');
  });

  it('defaults driver and scope to empty strings when missing', () => {
    const info = toNetworkInfo(
      rawNetwork({
        Driver: undefined as unknown as string,
        Scope: undefined as unknown as string,
      }),
    );
    expect(info.driver).toBe('');
    expect(info.scope).toBe('');
  });

  it('parses the Created timestamp', () => {
    const info = toNetworkInfo(rawNetwork({ Created: '2026-05-14T12:00:00.000Z' }));
    expect(info.created.toISOString()).toBe('2026-05-14T12:00:00.000Z');
  });

  it('falls back to epoch zero when Created is absent', () => {
    expect(toNetworkInfo(rawNetwork({ Created: '' })).created.getTime()).toBe(0);
  });

  it('starts with no users: App joins them in from the container listing', () => {
    const info = toNetworkInfo(rawNetwork());
    expect(info.users).toEqual([]);
    expect(info.containerCount).toBe(0);
    expect(info.inUse).toBe(false);
  });

  it('reads subnets and gateways from IPAM', () => {
    const info = toNetworkInfo(
      rawNetwork({
        IPAM: {
          Config: [{ Subnet: '172.18.0.0/16', Gateway: '172.18.0.1' }, { Subnet: 'fd00::/64' }],
        },
      }),
    );
    expect(info.subnets).toEqual(['172.18.0.0/16', 'fd00::/64']);
    expect(info.gateways).toEqual(['172.18.0.1']);
  });

  it('has no subnets when IPAM.Config is null (host, none)', () => {
    const info = toNetworkInfo(rawNetwork({ IPAM: { Driver: 'default', Config: null as any } }));
    expect(info.subnets).toEqual([]);
    expect(info.gateways).toEqual([]);
  });

  it("reads compose's labels, and tolerates null ones", () => {
    const info = toNetworkInfo(
      rawNetwork({
        Internal: true,
        Labels: { 'com.docker.compose.project': 'db-pr02', 'com.docker.compose.network': 'default' },
      }),
    );
    expect(info.stack).toBe('db-pr02');
    expect(info.composeNetwork).toBe('default');
    expect(info.internal).toBe(true);
    const bare = toNetworkInfo(rawNetwork({ Labels: null as any }));
    expect(bare.labels).toEqual({});
    expect(bare.stack).toBeUndefined();
  });

  it('flags the predefined bridge / host / none networks as built-in', () => {
    expect(toNetworkInfo(rawNetwork({ Name: 'bridge' })).builtin).toBe(true);
    expect(toNetworkInfo(rawNetwork({ Name: 'host' })).builtin).toBe(true);
    expect(toNetworkInfo(rawNetwork({ Name: 'none' })).builtin).toBe(true);
  });

  it('does not flag user-defined networks as built-in', () => {
    expect(toNetworkInfo(rawNetwork({ Name: 'app_default' })).builtin).toBe(false);
  });
});
