import type blessed from 'neo-blessed';
import type { ContainerInfo, ContainerStats, MountInfo } from '@models/docker';
import type { PanelFocus, ResourceRef } from '@models/nav';
import { t } from '@theme';
import { escapeTags, humanSizeMB, oneLine } from '@utils/format';
import { colorByStatus, cpuColor, isActive, memColor, statusLabel } from '@utils/status';
import { textOption, type CopyOption } from '@ui/copy-menu';
import { EnvSection } from '@ui/containers/env-section';
import { MOUNT_ROWS } from '@ui/containers/mount-rows';
import { DetailPanel, type CopyFn } from '@ui/detail/detail-panel';
import type { PanelSection } from '@ui/detail/panel-section';
import { RefSection } from '@ui/detail/ref-section';
import { charWidth, type Dims } from '@ui/widgets';

export type { CopyFn } from '@ui/detail/detail-panel';

const BAR_WIDTH = 20;

type Handler = () => void;
type SectionHandler = (section: string | null) => void;
type GotoHandler = (ref: ResourceRef) => void;
type MessageHandler = (message: string) => void;

/**
 * A container's detail: summary, live stats, MOUNTS and ENV, inside the shared `DetailPanel`.
 * Tab walks the cursor MOUNTS → ENV; ↵ on a volume mount opens that volume's detail.
 */
export class ContainerDetail {
  private readonly panel: DetailPanel;
  private mounts = new RefSection<MountInfo>(MOUNT_ROWS, charWidth);
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
        sections: () => [this.mounts, this.env],
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
    this.mounts.reset(container.mounts);
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
    this.mounts.setRows(container.mounts);
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
      textOption('m', 'image', c.image, 'image'),
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

    lines.push(`{bold}${t.purple(c.name)}{/bold}  ${t.comment(`${c.image} · ${c.id.slice(0, 12)}`)}`);
    lines.push(colorByStatus(c, `● ${statusLabel(c)}`));
    lines.push('');

    lines.push(`${t.comment('Uptime:')}   ${colorByStatus(c, c.uptime)}`);
    lines.push(`${t.comment('Restart:')}  ${c.restartPolicy}`);
    lines.push(`${t.comment('PIDs:')}     ${c.status === 'running' ? String(c.pids) : t.comment('—')}`);

    if (c.ports.length > 0) {
      lines.push('');
      lines.push(t.comment('Ports:'));
      for (const p of c.ports) lines.push(`  ${t.pink(p)}`);
    }

    if (c.networks.length > 0) {
      lines.push('');
      const info = c.ip ? `${c.networks[0]} · ${c.ip}` : c.networks[0];
      lines.push(`${t.comment('Network:')}  ${t.cyan(info)}`);
      for (const n of c.networks.slice(1)) lines.push(`           ${t.cyan(n)}`);
    }

    if (stats && c.status === 'running') {
      lines.push('');
      lines.push(this.cpuBar(stats.cpuPercent));
      lines.push(this.memBar(stats.memPercent, stats.memUsageMB, stats.memLimitMB));
      lines.push(this.diskLine(stats.diskReadMB, stats.diskWriteMB));
    }

    if (c.mounts.length > 0) {
      lines.push('');
      lines.push(this.mounts);
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
