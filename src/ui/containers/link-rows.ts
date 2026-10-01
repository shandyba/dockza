import type { ContainerLink, ContainerRelation } from '@models/docker';
import { t } from '@theme';
import { containerRef } from '@utils/nav-history';
import { colorByStatus } from '@utils/status';
import { textOption, type CopyOption } from '@ui/copy-menu';
import { allNames } from '@ui/detail/copy-all';
import type { RefSectionSpec } from '@ui/detail/ref-section';

const LABEL: Record<ContainerRelation, string> = {
  'depends-on': 'depends on',
  'needed-by': 'needed by',
  'network-of': 'network of',
  'shares-network': 'shares its network with',
  'volumes-from': 'volumes from',
  'lends-volumes': 'lends volumes to',
};

function note(l: ContainerLink): string {
  if (!l.container) return l.service ? 'no container runs this service' : 'no such container';
  return l.service ? `(compose depends_on: ${l.service})` : '';
}

/**
 * A container's DEPENDS ON: the other containers it relates to, each way round — compose's
 * `depends_on`, a network stack it shares, volumes it borrows. A row is a link to that container.
 *
 *   depends on  ● dzlink-db-1   (compose depends_on: db)
 *   needed by   ● dzlink-api-1  (compose depends_on: db)
 *   network of  ● dzlink-db-1
 */
export const LINK_ROWS: RefSectionSpec<ContainerLink> = {
  id: 'links',
  title: 'DEPENDS ON',
  follow: 'open container',
  empty: 'none',
  key: (l) => `${l.relation}:${l.container?.id ?? l.target}`,
  cells: (l) => {
    const c = l.container;
    return [
      { text: LABEL[l.relation], color: t.comment },
      c
        ? { text: c.name, grow: true, link: true, dot: (s: string) => colorByStatus(c, s) }
        : { text: l.target, grow: true, color: t.comment },
      { text: note(l), grow: true, color: c ? t.comment : t.orange },
    ];
  },
  ref: (l) => (l.container ? containerRef(l.container) : null),
  copy: (l: ContainerLink, all: ContainerLink[]): CopyOption[] => [
    textOption('n', 'container name', l.container?.name ?? l.target, 'container name'),
    textOption('i', 'container ID', l.container?.id, 'container ID', 'no such container'),
    allNames(
      all.map((x) => x.container?.name ?? x.target),
      'container name',
      'no related containers',
    ),
  ],
};
