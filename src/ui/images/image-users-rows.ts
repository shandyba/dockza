import type { ImageUser } from '@models/docker';
import { containerRef } from '@utils/nav-history';
import { colorByStatus, statusLabel } from '@utils/status';
import { textOption, type CopyOption } from '@ui/copy-menu';
import { allNames } from '@ui/detail/copy-all';
import type { RefSectionSpec } from '@ui/detail/ref-section';

/**
 * An image's USED BY: each container created from it, and whether it's running. A row is a link
 * to that container's detail.
 *
 *   ● db-pr02  exited(0)
 */
export const IMAGE_USERS_ROWS: RefSectionSpec<ImageUser> = {
  id: 'users',
  title: 'USED BY',
  follow: 'open container',
  empty: 'none — no container runs this image',
  key: (u) => u.id,
  cells: (u) => [
    { text: u.name, grow: true, link: true, dot: (s) => colorByStatus(u, s) },
    { text: statusLabel(u), color: (s) => colorByStatus(u, s) },
  ],
  ref: containerRef,
  copy: (u: ImageUser, all: ImageUser[]): CopyOption[] => [
    textOption('n', 'container name', u.name, 'container name'),
    textOption('i', 'container ID', u.id, 'container ID'),
    allNames(
      all.map((x) => x.name),
      'container name',
      'no container uses it',
    ),
  ],
};
