import type { NetworkUser } from '@models/docker';
import { t } from '@theme';
import { containerRef } from '@utils/nav-history';
import { colorByStatus, statusLabel } from '@utils/status';
import { textOption, type CopyOption } from '@ui/copy-menu';
import { aliasList } from '@ui/containers/network-rows';
import { allNames } from '@ui/detail/copy-all';
import type { RefSectionSpec } from '@ui/detail/ref-section';

/**
 * A network's USED BY: each container attached to it, its address there, and the names it answers
 * to. A row is a link to that container's detail.
 *
 *   ● dzlink-db-1   running    172.20.0.2  dzlink-db-1, db
 *   ● dzlink-api-1  exited(0)  —           dzlink-api-1, api
 */
export const NETWORK_USERS_ROWS: RefSectionSpec<NetworkUser> = {
  id: 'users',
  title: 'USED BY',
  follow: 'open container',
  empty: 'none — no container is attached',
  key: (u) => u.id,
  cells: (u) => [
    { text: u.name, grow: true, link: true, dot: (s) => colorByStatus(u, s) },
    { text: statusLabel(u), color: (s) => colorByStatus(u, s) },
    u.ip ? { text: u.ip, color: t.cyan } : { text: '—', color: t.comment },
    { text: aliasList(u.aliases), grow: true, color: t.comment },
  ],
  ref: containerRef,
  copy: (u: NetworkUser, all: NetworkUser[]): CopyOption[] => [
    textOption('n', 'container name', u.name, 'container name'),
    textOption('i', 'container ID', u.id, 'container ID'),
    textOption('p', 'IP address', u.ip, 'IP address', 'no address — the container is stopped'),
    textOption('d', 'DNS names', u.aliases.join('\n'), 'DNS names', 'no names on this network'),
    allNames(
      all.map((x) => x.name),
      'container name',
      'no container is attached',
    ),
  ],
};
