import type blessed from 'neo-blessed';
import type {
  ContainerInfo,
  ContainerLink,
  ContainerStats,
  MountInfo,
  NetworkEndpoint,
  PortInfo,
} from '@models/docker';
import type { PanelFocus, ResourceRef } from '@models/nav';
import { t } from '@theme';
import { escapeTags, humanSizeMB, oneLine, shortId } from '@utils/format';
import { shownImage } from '@utils/outdated';
import { colorByStatus, cpuColor, isActive, memColor, statusLabel } from '@utils/status';
import { textOption, type CopyOption } from '@ui/copy-menu';
import { containerRelated } from '@ui/containers/container-related';
import { EnvSection } from '@ui/containers/env-section';
import { LINK_ROWS } from '@ui/containers/link-rows';
import { MOUNT_ROWS } from '@ui/containers/mount-rows';
import { NETWORK_ROWS } from '@ui/containers/network-rows';
import { PORT_ROWS } from '@ui/containers/port-rows';
import { DetailPanel, type CopyFn } from '@ui/detail/detail-panel';
import type { PanelSection } from '@ui/detail/panel-section';
import { RefSection } from '@ui/detail/ref-section';
import { relatedRows, type RelatedRow } from '@ui/detail/related-rows';
import type { Hint } from '@ui/footer';
import { charWidth, type Dims } from '@ui/widgets';

export type { CopyFn } from '@ui/detail/detail-panel';

const BAR_WIDTH = 20;

/** Untrusted text (names, labels) for tagged content. */
const safe = (s: string): string => escapeTags(oneLine(s));

type Handler = () => void;
type SectionHandler = (section: string | null) => void;
type GotoHandler = (ref: ResourceRef) => void;
type MessageHandler = (message: string) => void;

/**
 * A container's detail: summary, live stats, RELATED, MOUNTS and ENV, inside the shared
 * `DetailPanel`. Tab walks the cursor through the sections in the order they're shown; ↵ on a
 * reference (its image, a volume mount) opens that object's detail.
 */
export class ContainerDetail {
  private readonly panel: DetailPanel;
  private related = new RefSection<RelatedRow>(relatedRows('none'), charWidth);
  private ports = new RefSection<PortInfo>(PORT_ROWS, charWidth);
  private networks = new RefSection<NetworkEndpoint>(NETWORK_ROWS, charWidth);
  private mounts = new RefSection<MountInfo>(MOUNT_ROWS, charWidth);
  private links = new RefSection<ContainerLink>(LINK_ROWS, charWidth);
  private env = new EnvSection(charWidth);

  private container: ContainerInfo | null = null;
  private lastStats: ContainerStats | undefined;

  constructor(screen: blessed.Widgets.Screen, dims: Dims, copy?: CopyFn) {
    this.panel = new DetailPanel(
      screen,
      dims,
      {
        header: () => this.header(),
        blocks: () => this.blocks(),
        sections: () => [this.related, this.ports, this.networks, this.mounts, this.links, this.env],
        subjectCopy: () => this.subjectCopy(),
        onKey: (key) => this.onKey(key),
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

  show(container: ContainerInfo, stats?: ContainerStats): void {
    this.container = container;
    if (stats !== undefined) this.lastStats = stats;
    this.related.reset(containerRelated(container));
    this.ports.reset(container.ports);
    this.networks.reset(container.networks);
    this.mounts.reset(container.mounts);
    this.links.reset(container.links ?? []);
    this.env.reset(container.env);
    this.panel.show();
  }

  /** Safe to call when hidden (see `DetailPanel.hide`). */
  hide(): void {
    this.panel.hide();
  }

  update(container: ContainerInfo, stats?: ContainerStats): void {
    this.container = container;
    if (stats !== undefined) this.lastStats = stats;
    this.related.setRows(containerRelated(container));
    this.ports.setRows(container.ports);
    this.networks.setRows(container.networks);
    this.mounts.setRows(container.mounts);
    this.links.setRows(container.links ?? []);
    this.env.setVars(container.env);
    this.panel.refresh();
  }

  isVisible(): boolean {
    return this.panel.isVisible();
  }

  getContainerId(): string | null {
    return this.container?.id ?? null;
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

  /** `e`: show ENV with the cursor on it, or hide it when the cursor is already there. */
  private onKey(key: string): boolean {
    if (key !== 'e') return false;
    if (this.panel.focusedSection() === this.env.id) {
      this.env.close();
      this.panel.focus(null);
    } else if (this.env.focusable()) {
      this.panel.focus(this.env.id);
    }
    return true;
  }

  private subjectCopy(): CopyOption[] {
    const c = this.container;
    if (!c) return [];
    const allEnv = this.env.copyOptions().find((o) => o.key === 'a');
    return [
      textOption('n', 'name', c.name, 'container name'),
      textOption('i', 'ID', c.id, 'container ID'),
      textOption('m', 'image', c.imageName, 'image'),
      ...(allEnv ? [{ ...allEnv, label: `all env (${this.env.count()})` }] : []),
    ];
  }

  private header(): string {
    const name = this.container ? escapeTags(oneLine(this.container.name)) : '';
    return ` ${t.purple('DETAIL')} — ${t.fg(name)}`;
  }

  private blocks(): Array<string | PanelSection> {
    const c = this.container;
    if (!c) return [];
    const stats = this.lastStats;
    const lines: Array<string | PanelSection> = [];

    const image = `${c.outdated ? t.orange('↑ ') : ''}${t.comment(safe(shownImage(c)))}`;
    lines.push(`{bold}${t.purple(safe(c.name))}{/bold}  ${image}${t.comment(` · ${shortId(c.id)}`)}`);
    lines.push(colorByStatus(c, `● ${statusLabel(c)}`));
    lines.push('');

    lines.push(`${t.comment('Uptime:')}   ${colorByStatus(c, c.uptime)}`);
    lines.push(`${t.comment('Restart:')}  ${c.restartPolicy}`);
    lines.push(`${t.comment('PIDs:')}     ${c.status === 'running' ? String(c.pids) : t.comment('—')}`);

    if (stats && c.status === 'running') {
      lines.push('');
      lines.push(this.cpuBar(stats.cpuPercent));
      lines.push(this.memBar(stats.memPercent, stats.memUsageMB, stats.memLimitMB));
      lines.push(this.diskLine(stats.diskReadMB, stats.diskWriteMB));
    }

    lines.push('');
    lines.push(this.related);

    if (c.ports.length > 0) {
      lines.push('');
      lines.push(this.ports);
    }

    if (c.networks.length > 0) {
      lines.push('');
      lines.push(this.networks);
    }

    if (c.mounts.length > 0) {
      lines.push('');
      lines.push(this.mounts);
    }

    if (this.links.count() > 0) {
      lines.push('');
      lines.push(this.links);
    }

    lines.push('');
    lines.push(this.env);

    lines.push('');
    lines.push(this.actionsLine(c));
    return lines;
  }

  private cpuBar(cpu: number): string {
    const filled = Math.min(BAR_WIDTH, Math.round((cpu / 100) * BAR_WIDTH));
    const color = cpuColor(cpu);
    const bar = `[${color('█'.repeat(filled))}${t.comment('░'.repeat(BAR_WIDTH - filled))}]`;
    return `${t.comment('CPU')}    ${bar} ${color(`${cpu.toFixed(1)}%`)}`;
  }

  private memBar(mem: number, usageMB: number, limitMB: number): string {
    const filled = Math.min(BAR_WIDTH, Math.round((mem / 100) * BAR_WIDTH));
    const color = memColor(mem);
    const bar = `[${color('█'.repeat(filled))}${t.comment('░'.repeat(BAR_WIDTH - filled))}]`;
    const label = `(${humanSizeMB(usageMB)} / ${humanSizeMB(limitMB)})`;
    return `${t.comment('MEM')}    ${bar} ${color(`${mem.toFixed(1)}%`)} ${t.comment(label)}`;
  }

  private diskLine(readMB: number, writeMB: number): string {
    return `${t.comment('DISK')}   ${t.comment('R:')}${t.cyan(humanSizeMB(readMB))}  ${t.comment('W:')}${t.orange(humanSizeMB(writeMB))}`;
  }

  private actionsLine(c: ContainerInfo): string {
    if (isActive(c.status)) {
      return `  ${t.red('[s] Stop')}  ${t.green('[r] Restart')}  ${t.orange('[k] Kill')}  ${t.purple('[x] Shell')}  ${t.cyan('[l] Logs')}  ${t.yellow('[e] Env')}  ${t.aqua('[y] Copy')}  ${t.comment('Esc close')}`;
    }
    return `  ${t.green('[S] Start')}  ${t.red('[d] Remove')}  ${t.cyan('[l] Logs')}  ${t.yellow('[e] Env')}  ${t.aqua('[y] Copy')}  ${t.comment('Esc close')}`;
  }
}
