import type blessed from 'neo-blessed';
import type { NetworkInfo, NetworkUser } from '@models/docker';
import type { PanelFocus, ResourceRef } from '@models/nav';
import { t } from '@theme';
import { dateTime, escapeTags, oneLine, relativeTime, shortId } from '@utils/format';
import { textOption, type CopyOption } from '@ui/copy-menu';
import { allNames } from '@ui/detail/copy-all';
import { DetailPanel, type CopyFn } from '@ui/detail/detail-panel';
import type { PanelSection } from '@ui/detail/panel-section';
import { RefSection } from '@ui/detail/ref-section';
import { relatedRows, type RelatedRow } from '@ui/detail/related-rows';
import type { Hint } from '@ui/footer';
import { networkRelated } from '@ui/networks/network-related';
import { NETWORK_USERS_ROWS } from '@ui/networks/network-users-rows';
import type { ResourceDetail } from '@ui/resource-list-tab';
import { charWidth, type Dims } from '@ui/widgets';

type Handler = () => void;
type SectionHandler = (section: string | null) => void;
type GotoHandler = (ref: ResourceRef) => void;
type MessageHandler = (message: string) => void;

/** Untrusted text (names, labels) for tagged content. */
const safe = (s: string): string => escapeTags(oneLine(s));

/** Several values, one copy: one per line. */
function linesOption(key: string, label: string, values: string[], noun: string, reason: string): CopyOption {
  return { ...textOption(key, label, values.join('\n'), noun, reason), preview: values.join(', ') };
}

/**
 * A network's detail: driver, addressing, the compose project it belongs to (RELATED), and which
 * containers are attached to it, with their addresses and DNS names. Tab walks RELATED → USED BY;
 * ↵ opens the stack or container a row names.
 */
export class NetworkDetail implements ResourceDetail<NetworkInfo> {
  private readonly panel: DetailPanel;
  private readonly related = new RefSection<RelatedRow>(
    relatedRows('none — not a compose network'),
    charWidth,
  );
  private readonly users = new RefSection<NetworkUser>(NETWORK_USERS_ROWS, charWidth);
  private network: NetworkInfo | null = null;

  constructor(screen: blessed.Widgets.Screen, dims: Dims, copy?: CopyFn) {
    this.panel = new DetailPanel(
      screen,
      dims,
      {
        header: () =>
          ` ${t.purple('DETAIL')} — ${t.fg(safe(this.network?.name ?? ''))}  ${t.comment('network')}`,
        blocks: () => this.blocks(),
        sections: () => [this.related, this.users],
        subjectCopy: () => this.subjectCopy(),
      },
      copy,
    );
  }

  get box(): blessed.Widgets.BoxElement {
    return this.panel.box;
  }

  on(event: 'close-request', handler: Handler): void;
  on(event: 'section', handler: SectionHandler): void;
  on(event: 'goto', handler: GotoHandler): void;
  on(event: 'info' | 'error', handler: MessageHandler): void;
  on(
    event: 'close-request' | 'section' | 'goto' | 'info' | 'error',
    handler: Handler | SectionHandler | GotoHandler | MessageHandler,
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the overloads above keep callers typed
    this.panel.on(event as any, handler as any);
  }

  show(network: NetworkInfo): void {
    this.network = network;
    this.related.reset(networkRelated(network));
    this.users.reset(network.users);
    this.panel.show();
  }

  update(network: NetworkInfo): void {
    this.network = network;
    this.related.setRows(networkRelated(network));
    this.users.setRows(network.users);
    this.panel.refresh();
  }

  /** Safe to call when hidden (see `DetailPanel.hide`). */
  hide(): void {
    this.panel.hide();
  }

  isVisible(): boolean {
    return this.panel.isVisible();
  }

  focusedSection(): string | null {
    return this.panel.focusedSection();
  }

  focusedHints(): Hint[] | null {
    return this.panel.focusedHints();
  }

  getFocus(): PanelFocus | undefined {
    return this.panel.getFocus();
  }

  setFocus(focus: PanelFocus | undefined): void {
    this.panel.setFocus(focus);
  }

  private subjectCopy(): CopyOption[] {
    const net = this.network;
    if (!net) return [];
    const noIpam = `no IPAM config on a ${net.driver || 'this'} network`;
    return [
      textOption('n', 'name', net.name, 'network name'),
      textOption('i', 'ID', net.id, 'network ID'),
      linesOption('s', 'subnet', net.subnets, 'subnet', noIpam),
      linesOption('g', 'gateway', net.gateways, 'gateway', noIpam),
      allNames(
        net.users.map((u) => u.name),
        'container name',
        'no container is attached',
        'all users',
      ),
    ];
  }

  private blocks(): Array<string | PanelSection> {
    const net = this.network;
    if (!net) return [];
    const n = net.containerCount;
    const created =
      net.created.getTime() > 0 ? `${dateTime(net.created)} · ${relativeTime(net.created)}` : '—';
    const list = (values: string[]): string =>
      values.length > 0 ? t.cyan(safe(values.join(', '))) : t.comment('—');
    const kind = [net.driver, net.scope].filter((s) => s !== '').map(safe);

    return [
      `{bold}${t.purple(safe(net.name))}{/bold}  ${t.comment([...kind, shortId(net.id)].join(' · '))}`,
      net.inUse
        ? t.green(`● in use · ${n} container${n === 1 ? '' : 's'}`)
        : t.red(net.orphaned ? '○ orphaned' : '○ unused'),
      '',
      `${t.comment('Subnet:')}    ${list(net.subnets)}`,
      `${t.comment('Gateway:')}   ${list(net.gateways)}`,
      `${t.comment('Internal:')}  ${net.internal ? t.yellow('yes — no outside access') : 'no'}`,
      `${t.comment('Built-in:')}  ${net.builtin ? "yes — Docker's own, can't be removed" : 'no'}`,
      `${t.comment('Created:')}   ${created}`,
      '',
      this.related,
      '',
      this.users,
      '',
      this.actionsLine(net),
    ];
  }

  private actionsLine(net: NetworkInfo): string {
    const why = net.builtin ? 'built-in' : net.inUse ? 'in use' : null;
    const remove = why ? t.faint(`[d] Remove (${why})`) : t.red('[d] Remove');
    return `  ${remove}  ${t.aqua('[y] Copy')}  ${t.comment('Esc close')}`;
  }
}
