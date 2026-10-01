import type { MountInfo } from '@models/docker';
import { t } from '@theme';
import { hostPath, mountOrigin, mountSpec } from '@utils/mounts';
import { volumeRef } from '@utils/nav-history';
import { textOption, type CopyOption } from '@ui/copy-menu';
import type { RefSectionSpec } from '@ui/detail/ref-section';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Where a mount's data lives, as something you can paste: the host path for a bind. */
function sourcePath(m: MountInfo): string {
  return m.type === 'bind' ? hostPath(m.source) : m.source;
}

function mountCopy(m: MountInfo, all: MountInfo[]): CopyOption[] {
  const specs = all.map(mountSpec).filter((s): s is string => s !== null);
  const notVolume = `${m.type} mount — no volume`;
  return [
    textOption('n', 'volume name', m.type === 'volume' ? m.name : null, 'volume name', notVolume),
    textOption('s', m.type === 'bind' ? 'host path' : 'source path', sourcePath(m), 'path'),
    textOption('d', 'destination', m.destination, 'destination'),
    textOption('y', '-v spec', mountSpec(m), '-v spec', `-v can't express a ${m.type} mount`),
    {
      key: 'a',
      label: `all (${specs.length})`,
      preview: '-v specs, one per line',
      text: specs.length > 0 ? specs.join('\n') : null,
      reason: 'no mount -v can express',
      subject: plural(specs.length, '-v spec'),
    },
  ];
}

/**
 * A container's MOUNTS: what is mounted where, and from which volume. A named or anonymous volume
 * is a link to that volume's detail; a bind shows its host path.
 *
 *   volume  db-pr02_pgdata             → /var/lib/postgresql  rw
 *   bind    /private/tmp/db-pr02/sql   → /sql                 rw
 */
export const MOUNT_ROWS: RefSectionSpec<MountInfo> = {
  id: 'mounts',
  title: 'MOUNTS',
  follow: 'open volume',
  empty: 'none',
  key: (m) => m.destination,
  cells: (m) => [
    { text: m.type, color: t.comment },
    // A volume name's start identifies it (like a short ID); a path's ends say the most.
    { text: mountOrigin(m), grow: true, cut: m.type === 'volume' ? 'end' : 'middle', link: true },
    { text: `→ ${m.destination}`, grow: true, cut: 'middle' },
    { text: m.rw ? 'rw' : 'ro', color: m.rw ? t.comment : t.yellow },
  ],
  ref: (m) => (m.type === 'volume' && m.name ? volumeRef({ name: m.name }) : null),
  copy: mountCopy,
};
