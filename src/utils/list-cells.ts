import type { ContainerUser } from '@models/docker';
import { t } from '@theme';
import { escapeTags, fitWidth, oneLine } from '@utils/format';
import { statusDot } from '@utils/status';

/**
 * One-cell summary of the containers using something (a volume, an image, a network): the first
 * user (a running one when there is one) with its status dot, and `+N` for the other containers.
 * Fits in `width - 1`, leaving the column gap.
 */
export function formatUsedBy(users: ContainerUser[], width: number): string {
  if (users.length === 0) return t.comment('—');
  const first = users[0];
  const others = new Set(users.map((u) => u.id)).size - 1;
  const more = others > 0 ? ` +${others}` : '';
  const name = fitWidth(oneLine(first.name), Math.max(1, width - 3 - more.length)).text;
  return `${statusDot(first)} ${t.fg(escapeTags(name))}${t.comment(more)}`;
}

/**
 * One-cell summary of a list (networks, ports, tags): the first item in `color`, then `+N` for the
 * rest, or `—` when there are none. Fits in `width - 1`, leaving the column gap.
 */
export function formatFirst(items: string[], width: number, color: (s: string) => string): string {
  if (items.length === 0) return t.comment('—');
  const more = items.length > 1 ? ` +${items.length - 1}` : '';
  const first = fitWidth(oneLine(items[0]), Math.max(1, width - 1 - more.length)).text;
  return `${color(escapeTags(first))}${t.comment(more)}`;
}
