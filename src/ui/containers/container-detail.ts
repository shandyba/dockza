import blessed from 'neo-blessed';
import type { ContainerInfo, ContainerStats } from '@models/docker';
import { C, t } from '@theme';
import { copyToClipboard, describeCopy, type CopyResult } from '@utils/clipboard';
import { humanSizeMB } from '@utils/format';
import { colorByStatus, cpuColor, isActive, memColor, statusLabel } from '@utils/status';
import { revealRange } from '@utils/viewport';
import { CopyMenu, type PickedCopyOption } from '@ui/copy-menu';
import { EnvSection } from '@ui/containers/env-section';
import { charWidth, createHeaderBar, type Dims } from '@ui/widgets';

const BAR_WIDTH = 20;

type CloseHandler = () => void;
type EnvModeHandler = (active: boolean) => void;
type MessageHandler = (message: string) => void;

/** Puts text on the clipboard. Injected so tests don't touch the real one. */
export type CopyFn = (text: string) => Promise<CopyResult>;

interface KeyEvent {
  full: string;
}

function terminalCopy(screen: blessed.Widgets.Screen): CopyFn {
  return (text) =>
    copyToClipboard(text, {
      // Flush first so the sequence can't land in the middle of a buffered frame.
      writeTerminal: (seq) => {
        screen.program.flush();
        screen.program.write(seq);
      },
    });
}

export class ContainerDetail {
  private screen: blessed.Widgets.Screen;
  private wrapper: blessed.Widgets.BoxElement;
  private headerBox: blessed.Widgets.BoxElement;
  readonly box: blessed.Widgets.BoxElement;
  private copyMenu: CopyMenu;
  private env = new EnvSection(charWidth);

  private container: ContainerInfo | null = null;
  private lastStats: ContainerStats | undefined;
  private visible = false;
  /** Last value sent to `env-mode` listeners. */
  private envMode = false;
  /** Content lines (before blessed wraps them) holding the selected variable. */
  private activeLines: [number, number] | null = null;

  private closeHandlers: CloseHandler[] = [];
  private envModeHandlers: EnvModeHandler[] = [];
  private infoHandlers: MessageHandler[] = [];
  private errorHandlers: MessageHandler[] = [];

  private readonly handleClose = () => {
    if (!this.visible) return;
    this.hide();
    this.closeHandlers.forEach((h) => h());
  };

  /**
   * Every panel key except Esc. Bound to the box, not the screen, so it only acts while the panel
   * has focus — not under the help overlay — and goes quiet while the copy menu holds the keyboard.
   */
  private readonly handleKey = (_ch: unknown, key: KeyEvent) => {
    // `x` / `S` hide the panel without moving focus off it.
    if (!this.visible || this.copyMenu.isVisible()) return;
    switch (key.full) {
      case 'e':
        this.toggleEnv();
        return;
      case 'S-e':
        this.toggleAllValues();
        return;
      case 'y':
        this.openCopyMenu();
        return;
    }
    if (this.env.isNavigable()) this.navigateEnv(key.full);
    else this.scrollPanel(key.full);
  };

  private readonly handleResize = () => {
    if (this.visible) this.render();
  };

  constructor(
    screen: blessed.Widgets.Screen,
    dims: Dims,
    private readonly copy: CopyFn = terminalCopy(screen),
  ) {
    this.screen = screen;

    this.wrapper = blessed.box({
      parent: screen,
      top: dims.top,
      left: dims.left,
      width: dims.width,
      height: dims.height,
      style: { bg: C.bg },
      hidden: true,
    });

    this.headerBox = createHeaderBar(this.wrapper);

    // No `keys: true`: the arrows either scroll or move the env selection, so `handleKey` owns them.
    this.box = blessed.box({
      parent: this.wrapper,
      top: 1,
      left: 0,
      height: '100%-1',
      width: '100%',
      scrollable: true,
      mouse: true,
      tags: true,
      alwaysScroll: true,
      scrollbar: { ch: '│', style: { fg: C.comment } },
      style: { fg: C.fg, bg: C.bg },
      padding: { left: 2, right: 2 },
    });

    this.copyMenu = new CopyMenu(screen);

    this.box.on('keypress', this.handleKey);
    screen.on('resize', this.handleResize);
  }

  on(event: 'close', handler: CloseHandler): void;
  on(event: 'env-mode', handler: EnvModeHandler): void;
  on(event: 'info' | 'error', handler: MessageHandler): void;
  on(
    event: 'close' | 'env-mode' | 'info' | 'error',
    handler: CloseHandler | EnvModeHandler | MessageHandler,
  ): void {
    if (event === 'close') this.closeHandlers.push(handler as CloseHandler);
    if (event === 'env-mode') this.envModeHandlers.push(handler as EnvModeHandler);
    if (event === 'info') this.infoHandlers.push(handler as MessageHandler);
    if (event === 'error') this.errorHandlers.push(handler as MessageHandler);
  }

  show(container: ContainerInfo, stats?: ContainerStats): void {
    this.container = container;
    if (stats !== undefined) this.lastStats = stats;
    this.env.reset(container.env);
    this.envMode = false;
    this.visible = true;

    this.render();
    this.updateHeader();
    this.wrapper.show();
    this.box.focus();
    // A new container starts at the top, not where the previous one was scrolled to.
    this.box.scrollTo(0);

    this.screen.key(['escape'], this.handleClose);

    this.screen.render();
  }

  hide(): void {
    // First, so `grabKeys` is never left on by a poll that removes the container mid-menu.
    this.copyMenu.hide();
    this.visible = false;
    this.envMode = false;
    this.wrapper.hide();

    this.screen.removeKey('escape', this.handleClose);

    this.screen.render();
  }

  update(container: ContainerInfo, stats?: ContainerStats): void {
    this.container = container;
    if (stats !== undefined) this.lastStats = stats;
    this.env.setVars(container.env);
    if (this.visible) {
      // No reveal here: a poll must not undo the user's own scrolling.
      this.render();
      this.clampScroll();
      this.updateHeader();
      this.syncEnvMode();
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  getContainerId(): string | null {
    return this.container?.id ?? null;
  }

  private toggleEnv(): void {
    if (!this.env.toggleOpen()) return;
    this.render();
    if (this.env.isNavigable()) this.reveal();
    else this.clampScroll();
    this.syncEnvMode();
    this.screen.render();
  }

  private toggleAllValues(): void {
    if (!this.env.isNavigable()) return;
    this.env.toggleAllValues();
    this.render();
    this.reveal();
    this.clampScroll();
    this.screen.render();
  }

  private openCopyMenu(): void {
    if (this.env.count() === 0) {
      this.infoHandlers.forEach((h) => h('No environment variables to copy'));
      return;
    }
    this.copyMenu.show({ options: this.env.copyOptions(), onPick: (o) => this.copyOption(o) });
  }

  private copyOption(option: PickedCopyOption): void {
    void this.copy(option.text)
      .then((result) => {
        const { text, color } = describeCopy(option.subject, result);
        const handlers = color === 'green' ? this.infoHandlers : this.errorHandlers;
        handlers.forEach((h) => h(text));
      })
      .catch((err: unknown) => {
        const msg = `Copy failed: ${err instanceof Error ? err.message : String(err)}`;
        this.errorHandlers.forEach((h) => h(msg));
      });
  }

  private navigateEnv(key: string): void {
    const env = this.env;
    switch (key) {
      case 'up':
        // Past the first variable the panel itself scrolls on up, back to the container summary.
        if (env.atFirst()) return this.scrollPanel('home');
        env.move(-1);
        break;
      case 'down':
        if (env.atLast()) return this.scrollPanel('end');
        env.move(1);
        break;
      case 'pageup':
        env.move(-this.pageSize());
        break;
      case 'pagedown':
        env.move(this.pageSize());
        break;
      case 'home':
        env.first();
        break;
      case 'end':
        env.last();
        break;
      case 'enter':
        env.toggleValue();
        break;
      case 'right':
        env.expandValue();
        break;
      case 'left':
        env.collapseValue();
        break;
      default:
        return;
    }
    this.render();
    this.reveal();
    this.clampScroll();
    this.screen.render();
  }

  private scrollPanel(key: string): void {
    switch (key) {
      case 'up':
        this.box.scroll(-1);
        break;
      case 'down':
        this.box.scroll(1);
        break;
      case 'pageup':
        this.box.scroll(-this.pageSize());
        break;
      case 'pagedown':
        this.box.scroll(this.pageSize());
        break;
      case 'home':
        this.box.scrollTo(0);
        break;
      case 'end':
        this.box.setScrollPerc(100);
        break;
      default:
        return;
    }
    this.screen.render();
  }

  private viewport(): number {
    return Math.max(1, Number(this.box.height) - Number(this.box.iheight));
  }

  private pageSize(): number {
    return Math.max(1, this.viewport() - 1);
  }

  /**
   * Scroll so the selected variable is on screen. Content lines aren't screen rows — blessed wraps
   * anything wider than the box (a long mount path, say) — so map them through its wrap table.
   */
  private reveal(): void {
    if (!this.activeLines) return;
    const [first, last] = this.toRows(this.activeLines);
    this.box.scrollTo(revealRange(this.box.childBase, this.viewport(), first, last));
  }

  private toRows([start, end]: [number, number]): [number, number] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- `_clines` (blessed's wrapped lines) is untyped
    const ftor: number[][] | undefined = (this.box as any)._clines?.ftor;
    const first = ftor?.[start]?.[0] ?? start;
    const lastRows = ftor?.[end];
    const last = lastRows && lastRows.length > 0 ? lastRows[lastRows.length - 1] : end;
    return [first, last];
  }

  /** After content shrinks, pull the view back so the panel doesn't end in blank rows. */
  private clampScroll(): void {
    const max = Math.max(0, this.box.getScrollHeight() - this.viewport());
    if (this.box.childBase > max) this.box.scrollTo(max);
  }

  private syncEnvMode(): void {
    const active = this.env.isNavigable();
    if (active === this.envMode) return;
    this.envMode = active;
    this.envModeHandlers.forEach((h) => h(active));
  }

  private updateHeader(): void {
    if (!this.container) return;
    this.headerBox.setContent(` ${t.purple('DETAIL')} — ${t.fg(this.container.name)}`);
  }

  private render(): void {
    if (!this.container) return;
    this.box.setContent(this.buildContent(this.container, this.lastStats));
  }

  /** Widest an env line may be: blessed wraps at the inner width less the scrollbar column. */
  private envCols(): number {
    return Math.max(10, Number(this.box.width) - Number(this.box.iwidth) - 1);
  }

  private buildContent(c: ContainerInfo, stats?: ContainerStats): string {
    const lines: string[] = [];

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
      lines.push(t.comment('MOUNTS'));
      for (const m of c.mounts) {
        lines.push(t.comment(`${m.source} → ${m.destination} (${m.rw ? 'rw' : 'ro'})`));
      }
    }

    lines.push('');
    const envStart = lines.length;
    const env = this.env.render(this.envCols());
    lines.push(...env.lines);
    this.activeLines = env.activeRange
      ? [envStart + env.activeRange[0], envStart + env.activeRange[1]]
      : null;

    lines.push('');
    lines.push(this.actionsLine(c));

    return lines.join('\n');
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
