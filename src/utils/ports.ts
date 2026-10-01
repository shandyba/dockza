import type { PortInfo } from '@models/docker';

/** A port as the list payload reports it. Every field can be missing on an unpublished port. */
interface RawPort {
  IP?: string;
  PublicPort?: number;
  PrivatePort?: number;
  Type?: string;
}

/** Addresses that mean "every interface": a browser reaches them as `localhost`. */
const WILDCARD = new Set(['', '0.0.0.0', '::']);

const isWildcard = (ip: string | undefined): boolean => WILDCARD.has(ip ?? '');

function byPort(a: PortInfo, b: PortInfo): number {
  return (
    a.privatePort - b.privatePort ||
    a.type.localeCompare(b.type) ||
    (a.publicPort ?? 0) - (b.publicPort ?? 0) ||
    (a.ip ?? '').localeCompare(b.ip ?? '')
  );
}

/**
 * The list payload's ports, one per binding. A wildcard binding comes back twice, as
 * `0.0.0.0:5432` and `:::5432`: the IPv6 twin is dropped. Sorted, because the daemon builds the
 * list from a map and its order changes between calls.
 */
export function toPorts(raw: RawPort[] | null | undefined): PortInfo[] {
  const ports: PortInfo[] = [];
  const seen = new Set<string>();
  // IPv4 first, so it's the IPv4 address of a twin that stays.
  const ordered = [...(raw ?? [])].sort((a, b) => Number(a.IP === '::') - Number(b.IP === '::'));
  for (const p of ordered) {
    const port: PortInfo = {
      ...(p.PublicPort && p.IP !== undefined ? { ip: p.IP } : {}),
      ...(p.PublicPort ? { publicPort: p.PublicPort } : {}),
      privatePort: p.PrivatePort ?? 0,
      type: p.Type || 'tcp',
    };
    const host = isWildcard(port.ip) ? '*' : port.ip;
    const key = `${host}|${port.publicPort ?? ''}|${port.privatePort}|${port.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ports.push(port);
  }
  return ports.sort(byPort);
}

/** `0.0.0.0:8080->80/tcp`, or `80/tcp` when it isn't published: what `docker ps` prints. */
export function formatPort(p: PortInfo): string {
  if (p.publicPort === undefined) return `${p.privatePort}/${p.type}`;
  return `${p.ip ? `${p.ip}:` : ''}${p.publicPort}->${p.privatePort}/${p.type}`;
}

/** Where to reach a published port from this machine; `null` when it isn't published. */
export function portUrl(p: PortInfo): string | null {
  if (p.publicPort === undefined) return null;
  const host = isWildcard(p.ip) ? 'localhost' : p.ip!.includes(':') ? `[${p.ip}]` : p.ip;
  const scheme = p.type === 'tcp' ? 'http' : p.type;
  return `${scheme}://${host}:${p.publicPort}`;
}

/**
 * The binding as `docker run -p` takes it (`127.0.0.1:5432:5432/tcp`, `8080:80/tcp`): a wildcard
 * address is left out, as it would be typed. `null` for a port that isn't published.
 */
export function portSpec(p: PortInfo): string | null {
  if (p.publicPort === undefined) return null;
  const ip = isWildcard(p.ip) ? '' : p.ip!.includes(':') ? `[${p.ip}]:` : `${p.ip}:`;
  return `${ip}${p.publicPort}:${p.privatePort}/${p.type}`;
}
