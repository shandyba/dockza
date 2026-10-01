import type { ContainerInfo, VolumeInfo, VolumeUser } from '@models/docker';
import { t } from '@theme';
import { escapeTags, fitWidth, oneLine } from '@utils/format';
import { isActive, statusDot } from '@utils/status';

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
  const rank = (u: VolumeUser): number => (isActive(u.status) ? 0 : 1);
  for (const list of users.values()) {
    list.sort(
      (a, b) =>
        rank(a) - rank(b) || a.name.localeCompare(b.name) || a.destination.localeCompare(b.destination),
    );
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

/**
 * One-cell summary for the Volumes list: the first user (a running one when there is one) with its
 * status dot, and `+N` for the other containers. Fits in `width - 1`, leaving the column gap.
 */
export function formatUsedBy(users: VolumeUser[], width: number): string {
  if (users.length === 0) return t.comment('—');
  const first = users[0];
  const others = new Set(users.map((u) => u.id)).size - 1;
  const more = others > 0 ? ` +${others}` : '';
  const name = fitWidth(oneLine(first.name), Math.max(1, width - 3 - more.length)).text;
  return `${statusDot(first)} ${t.fg(escapeTags(name))}${t.comment(more)}`;
}
