import type { ContainerInfo, NetworkInfo, NetworkUser } from '@models/docker';
import { compareUsers } from '@utils/status';

/**
 * Every container attached to each network, keyed by network NAME, running or stopped — the way
 * `docker network rm` sees it. The list payload's own `Containers` is always empty.
 *
 * We key by name (the `NetworkSettings.Networks` map key), not the endpoint's
 * `NetworkID`: a stopped container can carry a *stale* NetworkID — the default
 * `bridge` network is recreated with a fresh ID on daemon restart, so an exited
 * container keeps pointing at the old ID and would never match the live network.
 * Docker forbids two networks sharing a name on one daemon, so the name is a
 * stable, unique key; it is also what the Containers view stores/shows
 * (`toContainerInfo`), keeping the two views consistent.
 */
export function networkUsers(containers: ContainerInfo[]): Map<string, NetworkUser[]> {
  const users = new Map<string, NetworkUser[]>();
  for (const c of containers) {
    for (const ep of c.networks) {
      const list = users.get(ep.name) ?? [];
      list.push({
        id: c.id,
        name: c.name,
        status: c.status,
        exitCode: c.exitCode,
        ip: ep.ip,
        aliases: ep.aliases,
      });
      users.set(ep.name, list);
    }
  }
  for (const list of users.values()) list.sort(compareUsers);
  return users;
}

/** The networks with their users joined in from the container listing. */
export function withNetworkUsers(networks: NetworkInfo[], containers: ContainerInfo[]): NetworkInfo[] {
  const byName = networkUsers(containers);
  return networks.map((net) => {
    const users = byName.get(net.name) ?? [];
    return { ...net, users, containerCount: users.length, inUse: users.length > 0 };
  });
}
