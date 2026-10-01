import type Dockerode from 'dockerode';
import { dockerode } from '@docker/client';
import type { NetworkInfo } from '@models/docker';
import { COMPOSE_NETWORK_LABEL, COMPOSE_PROJECT_LABEL } from '@utils/compose';

// Docker's predefined networks can never be removed.
const BUILTIN_NETWORKS = new Set(['bridge', 'host', 'none']);

/**
 * A network as the daemon lists it. `users` / `inUse` start empty: the list payload's `Containers`
 * is always empty, so who is attached comes from the container listing, which App owns and joins
 * in (`withNetworkUsers`).
 */
export function toNetworkInfo(raw: Dockerode.NetworkInspectInfo): NetworkInfo {
  // `IPAM.Config` is null for `host` and `none`; `Labels` can be null although typed otherwise.
  const ipam = raw.IPAM?.Config ?? [];
  const labels = raw.Labels ?? {};
  const stack = labels[COMPOSE_PROJECT_LABEL];
  const composeNetwork = labels[COMPOSE_NETWORK_LABEL];
  return {
    id: raw.Id,
    name: raw.Name,
    driver: raw.Driver ?? '',
    scope: raw.Scope ?? '',
    created: raw.Created ? new Date(raw.Created) : new Date(0),
    internal: raw.Internal ?? false,
    subnets: ipam.map((c) => c.Subnet ?? '').filter((s) => s !== ''),
    gateways: ipam.map((c) => c.Gateway ?? '').filter((g) => g !== ''),
    labels,
    ...(stack ? { stack } : {}),
    ...(composeNetwork ? { composeNetwork } : {}),
    users: [],
    containerCount: 0,
    inUse: false,
    builtin: BUILTIN_NETWORKS.has(raw.Name),
  };
}

export async function listNetworks(): Promise<NetworkInfo[]> {
  try {
    const rawNetworks = await dockerode.listNetworks();
    return rawNetworks.map(toNetworkInfo).sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    throw new Error(`Failed to list networks: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function removeNetwork(id: string): Promise<void> {
  try {
    await dockerode.getNetwork(id).remove();
  } catch (err) {
    throw new Error(`Failed to remove network ${id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
