import { describe, it, expect } from 'vitest';
import { networkUsers, withNetworkUsers } from '@utils/network-users';
import { endpoint, makeContainer, makeNetwork } from '../fixtures';

describe('networkUsers', () => {
  it('lists every attached container per network, keyed by name, with its address and aliases', () => {
    const users = networkUsers([
      makeContainer({
        id: 'c1',
        name: 'db-pr02',
        networks: [endpoint('db-pr02_default', { ip: '172.18.0.2', aliases: ['db-pr02', 'db'] })],
      }),
    ]);
    expect(users.get('db-pr02_default')).toEqual([
      {
        id: 'c1',
        name: 'db-pr02',
        status: 'running',
        exitCode: 0,
        ip: '172.18.0.2',
        aliases: ['db-pr02', 'db'],
      },
    ]);
  });

  it('counts attached containers regardless of state (running or stopped)', () => {
    const users = networkUsers([
      makeContainer({ id: 'a', networks: [endpoint('app')] }),
      makeContainer({ id: 'b', status: 'exited', networks: [endpoint('app')] }),
      makeContainer({ id: 'c', status: 'created', networks: [endpoint('app')] }),
    ]);
    expect(users.get('app')).toHaveLength(3);
  });

  it('counts a container attached to several networks once on each', () => {
    const users = networkUsers([makeContainer({ networks: [endpoint('a'), endpoint('b')] })]);
    expect(users.get('a')).toHaveLength(1);
    expect(users.get('b')).toHaveLength(1);
  });

  it('puts running users first, then sorts by name', () => {
    const users = networkUsers([
      makeContainer({ id: 'a', name: 'a-stopped', status: 'exited', networks: [endpoint('n')] }),
      makeContainer({ id: 'z', name: 'z-running', networks: [endpoint('n')] }),
      makeContainer({ id: 'b', name: 'b-running', networks: [endpoint('n')] }),
    ]);
    expect(users.get('n')?.map((u) => u.name)).toEqual(['b-running', 'z-running', 'a-stopped']);
  });

  it('ignores containers with no networks', () => {
    expect(networkUsers([makeContainer()]).size).toBe(0);
  });
});

describe('withNetworkUsers', () => {
  it('joins users in by name and derives the count and inUse from them', () => {
    const [used, unused] = withNetworkUsers(
      [makeNetwork('bridge'), makeNetwork('idle')],
      [
        makeContainer({ id: 'a', networks: [endpoint('bridge')] }),
        makeContainer({ id: 'b', networks: [endpoint('bridge')] }),
      ],
    );
    expect(used.containerCount).toBe(2);
    expect(used.inUse).toBe(true);
    expect(unused.containerCount).toBe(0);
    expect(unused.inUse).toBe(false);
  });

  it('does not modify the networks it was given', () => {
    const networks = [makeNetwork('bridge')];
    withNetworkUsers(networks, [makeContainer({ networks: [endpoint('bridge')] })]);
    expect(networks[0].users).toEqual([]);
  });
});
