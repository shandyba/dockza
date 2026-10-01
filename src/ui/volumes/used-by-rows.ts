import type { VolumeUser } from '@models/docker';
import { t } from '@theme';
import { containerRef } from '@utils/nav-history';
import { colorByStatus, statusLabel } from '@utils/status';
import { textOption, type CopyOption } from '@ui/copy-menu';
import { allNames } from '@ui/detail/copy-all';
import type { RefSectionSpec } from '@ui/detail/ref-section';

/**
 * A volume's USED BY: each container mounting it, where, and whether it's running. A row is a
 * link to that container's detail.
 *
 *   ● db-pr02  exited(0)  → /var/lib/postgresql  rw
 *
 * `volumeName` gives the `-v` spec its left half.
 */
export function usedByRows(volumeName: () => string): RefSectionSpec<VolumeUser> {
  const copy = (u: VolumeUser, all: VolumeUser[]): CopyOption[] => [
    textOption('n', 'container name', u.name, 'container name'),
    textOption('i', 'container ID', u.id, 'container ID'),
    textOption('d', 'destination', u.destination, 'destination'),
    textOption('y', '-v spec', `${volumeName()}:${u.destination}${u.rw ? '' : ':ro'}`, '-v spec'),
    allNames(
      all.map((x) => x.name),
      'container name',
      'no container uses it',
    ),
  ];

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
