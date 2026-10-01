import type { NetworkEndpoint } from '@models/docker';
import { t } from '@theme';
import { networkRef } from '@utils/nav-history';
import { textOption, type CopyOption } from '@ui/copy-menu';
import { allNames } from '@ui/detail/copy-all';
import type { RefSectionSpec } from '@ui/detail/ref-section';

/** The names other containers on the network resolve this one by, for a cell. */
export const aliasList = (aliases: string[]): string => aliases.join(', ');

/**
 * A container's NETWORKS: each network it is attached to, its address there (none while it is
 * stopped), and the names other containers on it resolve it by. A row is a link to the network.
 *
 *   dzlink_back   172.20.0.2  dzlink-db-1, db
 *   dzlink_front  —           dzlink-api-1, api
 */
export const NETWORK_ROWS: RefSectionSpec<NetworkEndpoint> = {
  id: 'networks',
  title: 'NETWORKS',
  follow: 'open network',
  empty: 'none',
  key: (n) => n.name,
  cells: (n) => [
    { text: n.name, grow: true, link: true },
    n.ip ? { text: n.ip, color: t.cyan } : { text: '—', color: t.comment },
    { text: aliasList(n.aliases), grow: true, color: t.comment },
  ],
  ref: networkRef,
  copy: (n: NetworkEndpoint, all: NetworkEndpoint[]): CopyOption[] => [
    textOption('n', 'network name', n.name, 'network name'),
    textOption('p', 'IP address', n.ip, 'IP address', 'no address — the container is stopped'),
    textOption('d', 'DNS names', n.aliases.join('\n'), 'DNS names', 'no names on this network'),
    allNames(
      all.map((x) => x.name),
      'network name',
      'no networks',
    ),
  ],
};
