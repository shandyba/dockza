import type { PortInfo } from '@models/docker';
import { t } from '@theme';
import { portSpec, portUrl } from '@utils/ports';
import { textOption, type CopyOption } from '@ui/copy-menu';
import type { RefSectionSpec } from '@ui/detail/ref-section';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The host side of a binding: `127.0.0.1:18080`, `[::]:8080`, or `—` when it isn't published. */
function hostSide(p: PortInfo): string {
  if (p.publicPort === undefined) return '—';
  if (!p.ip) return String(p.publicPort);
  return p.ip.includes(':') ? `[${p.ip}]:${p.publicPort}` : `${p.ip}:${p.publicPort}`;
}

/**
 * A container's PORTS: where each port it exposes is published on the host, and the URL to reach
 * it. Nothing to follow; `y` copies a binding as `docker run -p` takes it.
 *
 *   127.0.0.1:18080  → 80/tcp    http://127.0.0.1:18080
 *   —                → 5432/tcp  not published
 */
export const PORT_ROWS: RefSectionSpec<PortInfo> = {
  id: 'ports',
  title: 'PORTS',
  follow: '',
  empty: 'none',
  key: (p) => `${p.ip ?? ''}|${p.publicPort ?? ''}|${p.privatePort}/${p.type}`,
  cells: (p) => [
    p.publicPort === undefined ? { text: '—', color: t.comment } : { text: hostSide(p), color: t.pink },
    { text: `→ ${p.privatePort}/${p.type}` },
    {
      text: portUrl(p) ?? 'not published',
      grow: true,
      color: p.publicPort === undefined ? t.faint : t.comment,
    },
  ],
  ref: () => null,
  copy: (p: PortInfo, all: PortInfo[]): CopyOption[] => {
    const specs = all.map(portSpec).filter((s): s is string => s !== null);
    return [
      textOption('u', 'URL', portUrl(p), 'URL', 'not published on the host'),
      textOption('y', '-p spec', portSpec(p), '-p spec', 'not published on the host'),
      {
        key: 'a',
        label: `all (${specs.length})`,
        preview: '-p specs, one per line',
        text: specs.length > 0 ? specs.join('\n') : null,
        reason: 'no port is published',
        subject: plural(specs.length, '-p spec'),
      },
    ];
  },
};
