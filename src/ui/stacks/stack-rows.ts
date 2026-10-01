import type { ContainerInfo, NetworkInfo, VolumeInfo } from '@models/docker';
import { t } from '@theme';
import { containerRef, networkRef, volumeRef } from '@utils/nav-history';
import { shownImage } from '@utils/outdated';
import { colorByStatus, statusLabel } from '@utils/status';
import { textOption, type CopyOption } from '@ui/copy-menu';
import { allNames } from '@ui/detail/copy-all';
import type { RefSectionSpec } from '@ui/detail/ref-section';

/**
 * A stack's SERVICES: its containers, their compose service, status and image. A row is a link to
 * that container's detail.
 *
 *   ● dzlink-db-1   db   running  ↑ dzlink/base:1
 */
export const SERVICE_ROWS: RefSectionSpec<ContainerInfo> = {
  id: 'services',
  title: 'SERVICES',
  follow: 'open container',
  empty: 'none',
  key: (c) => c.id,
  cells: (c) => [
    { text: c.name, grow: true, link: true, dot: (s) => colorByStatus(c, s) },
    { text: c.compose?.service ?? '', color: t.comment },
    { text: statusLabel(c), color: (s) => colorByStatus(c, s) },
    {
      text: `${c.outdated ? '↑ ' : ''}${shownImage(c)}`,
      grow: true,
      color: c.outdated ? t.orange : t.comment,
    },
  ],
  ref: containerRef,
  copy: (c: ContainerInfo, all: ContainerInfo[]): CopyOption[] => [
    textOption('n', 'container name', c.name, 'container name'),
    textOption('i', 'container ID', c.id, 'container ID'),
    textOption('m', 'image', c.imageName, 'image'),
    allNames(
      all.map((x) => x.name),
      'container name',
      'no containers',
    ),
  ],
};

/**
 * A stack's VOLUMES: those its compose project created, by their key in the project, and whether
 * anything mounts them. A row is a link to the volume's detail.
 *
 *   dzlink_data  data  ● in use
 */
export const STACK_VOLUME_ROWS: RefSectionSpec<VolumeInfo> = {
  id: 'volumes',
  title: 'VOLUMES',
  follow: 'open volume',
  empty: 'none',
  key: (v) => v.name,
  cells: (v) => [
    { text: v.name, grow: true, link: true },
    { text: v.composeVolume ?? '', color: t.comment },
    v.inUse ? { text: '● in use', color: t.green } : { text: '○ unused', color: t.red },
  ],
  ref: volumeRef,
  copy: (v: VolumeInfo, all: VolumeInfo[]): CopyOption[] => [
    textOption('n', 'volume name', v.name, 'volume name'),
    textOption('p', 'mountpoint', v.mountpoint, 'mountpoint'),
    allNames(
      all.map((x) => x.name),
      'volume name',
      'no volumes',
    ),
  ],
};

/**
 * A stack's NETWORKS: those its compose project created, by their key in the project, and their
 * subnets. A row is a link to the network's detail.
 *
 *   dzlink_back  back  172.20.0.0/16
 */
export const STACK_NETWORK_ROWS: RefSectionSpec<NetworkInfo> = {
  id: 'networks',
  title: 'NETWORKS',
  follow: 'open network',
  empty: 'none',
  key: (n) => n.name,
  cells: (n) => [
    { text: n.name, grow: true, link: true },
    { text: n.composeNetwork ?? '', color: t.comment },
    { text: n.subnets.join(', '), grow: true, color: t.comment },
  ],
  ref: networkRef,
  copy: (n: NetworkInfo, all: NetworkInfo[]): CopyOption[] => [
    textOption('n', 'network name', n.name, 'network name'),
    textOption('i', 'network ID', n.id, 'network ID'),
    textOption('s', 'subnet', n.subnets.join('\n'), 'subnet', 'no IPAM config'),
    allNames(
      all.map((x) => x.name),
      'network name',
      'no networks',
    ),
  ],
};
