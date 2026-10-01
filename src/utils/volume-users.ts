import type { ContainerInfo, VolumeInfo, VolumeUser } from '@models/docker';
import { compareUsers } from '@utils/status';

/**
 * Every container mounting each volume, keyed by volume name. Running or stopped both count, the way
 * `docker volume rm` sees it. Running ones come first, so a one-name summary names a live user.
 */
export function volumeUsers(containers: ContainerInfo[]): Map<string, VolumeUser[]> {
  const users = new Map<string, VolumeUser[]>();
  for (const c of containers) {
    for (const m of c.mounts) {
      if (m.type !== 'volume' || !m.name) continue;
      const list = users.get(m.name) ?? [];
      list.push({
        id: c.id,
        name: c.name,
        status: c.status,
        exitCode: c.exitCode,
        destination: m.destination,
        rw: m.rw,
      });
      users.set(m.name, list);
    }
  }
  for (const list of users.values()) {
    list.sort((a, b) => compareUsers(a, b) || a.destination.localeCompare(b.destination));
  }
  return users;
}

/** The volumes with their users joined in from the container listing. */
export function withUsers(volumes: VolumeInfo[], containers: ContainerInfo[]): VolumeInfo[] {
  const byName = volumeUsers(containers);
  return volumes.map((v) => {
    const users = byName.get(v.name) ?? [];
    return { ...v, users, inUse: users.length > 0 };
  });
}
