import type { VolumeUser } from '@models/docker';
import { t } from '@theme';
import { containerRef } from '@utils/nav-history';
import { colorByStatus, statusLabel } from '@utils/status';
import { textOption, type CopyOption } from '@ui/copy-menu';
import type { RefSectionSpec } from '@ui/detail/ref-section';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * A volume's USED BY: each container mounting it, where, and whether it's running. A row is a
 * link to that container's detail.
 *
 *   ● db-pr02  exited(0)  → /var/lib/postgresql  rw
 *
 * `volumeName` gives the `-v` spec its left half.
 */
export function usedByRows(volumeName: () => string): RefSectionSpec<VolumeUser> {
  const copy = (u: VolumeUser, all: VolumeUser[]): CopyOption[] => {
    const names = [...new Set(all.map((x) => x.name))];
    return [
      textOption('n', 'container name', u.name, 'container name'),
      textOption('i', 'container ID', u.id, 'container ID'),
      textOption('d', 'destination', u.destination, 'destination'),
      textOption('y', '-v spec', `${volumeName()}:${u.destination}${u.rw ? '' : ':ro'}`, '-v spec'),
      {
        key: 'a',
        label: `all (${names.length})`,
        preview: 'container names, one per line',
        text: names.join('\n'),
        subject: plural(names.length, 'container name'),
      },
    ];
  };

  return {
    id: 'users',
    title: 'USED BY',
    follow: 'open container',
    empty: 'none — Docker keeps no record of containers that used it before',
    key: (u) => `${u.id}:${u.destination}`,
    cells: (u) => [
      { text: u.name, grow: true, link: true, dot: (s) => colorByStatus(u, s) },
      { text: statusLabel(u), color: (s) => colorByStatus(u, s) },
      { text: `→ ${u.destination}`, grow: true, cut: 'middle' },
      { text: u.rw ? 'rw' : 'ro', color: u.rw ? t.comment : t.yellow },
    ],
    ref: containerRef,
    copy,
  };
}
