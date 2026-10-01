import blessed from 'neo-blessed';
import { startContainer } from '@docker/containers';
import type { ContainerInfo, ContainerStats, NetworkInfo, VolumeInfo } from '@models/docker';
import type { Location, PanelLoc, ResourceRef } from '@models/nav';
import { containerRef, stackRef } from '@utils/nav-history';
import { NO_STACK, type Stack, type StackResources } from '@utils/stacks';
import { isActive } from '@utils/status';
import { openExternalShell } from '@utils/external-terminal';
import { ContainerDetail } from '@ui/containers/container-detail';
import { ConfirmDialog, type ActionDialog } from '@ui/containers/confirm-dialog';
import {
  containerKillDialog,
  containerRemoveDialog,
  containerRestartDialog,
  containerStopDialog,
} from '@ui/containers/container-actions';
import { LogViewer } from '@ui/containers/log-viewer';
import { FilterBar } from '@ui/filter-bar';
import { filteredHints, type FooterContext, type FooterHints } from '@ui/footer';
import { StackDetail } from '@ui/stacks/stack-detail';
import {
  stackDownDialog,
  stackKillDialog,
  stackRestartDialog,
  stackStart,
  stackStopDialog,
} from '@ui/stacks/stack-actions';
import { StackTree } from '@ui/stacks/stack-tree';
import type { TabNav, ViewTab } from '@ui/view-tab';
import type { AlsoChanges, Dims, RunMutation } from '@ui/widgets';

type Handler = () => void;
type MessageHandler = (message: string) => void;

export class StacksTab implements ViewTab {
  readonly view = 'stacks' as const;
  private screen: blessed.Widgets.Screen;
  private wrapper: blessed.Widgets.BoxElement;

  private tree: StackTree;
  private containerDetail: ContainerDetail;
  private stackDetail: StackDetail;
  private confirmDialog: ConfirmDialog;
  private logViewer: LogViewer;
  private filterBar: FilterBar;

  private containers: ContainerInfo[] = [];
  private stacks: Stack[] = [];
  /** App's volumes and networks, for a stack detail to pick its own from. */
  private resources: StackResources = { volumes: [], networks: [] };
  private statsCache = new Map<string, ContainerStats>();
  private active = false;

  private contextHandlers: Handler[] = [];
  private errorHandlers: MessageHandler[] = [];
  private infoHandlers: MessageHandler[] = [];

  constructor(
    screen: blessed.Widgets.Screen,
    dims: Dims,
    private readonly runMutation: RunMutation,
    private readonly nav: TabNav,
  ) {
    this.screen = screen;

    this.wrapper = blessed.box({
      parent: screen,
      top: dims.top,
      left: dims.left,
      width: dims.width,
      height: dims.height,
      hidden: true,
    });

    this.tree = new StackTree(this.wrapper, {
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
    });

    this.filterBar = new FilterBar(screen, this.tree.list);

    this.containerDetail = new ContainerDetail(screen, dims);
    this.stackDetail = new StackDetail(screen, dims);
    this.confirmDialog = new ConfirmDialog(screen);
    this.logViewer = new LogViewer(screen, dims);

    this.tree.on('navigate', () => this.emitContext());

    this.containerDetail.on('close-request', () => this.nav.open(null));
    this.containerDetail.on('goto', (ref) => this.nav.follow(ref));
    this.containerDetail.on('section', () => this.emitContext());
    this.containerDetail.on('info', (msg) => this.infoHandlers.forEach((h) => h(msg)));

    this.logViewer.on('close-request', () => this.nav.open(null));
    this.logViewer.on('detail-request', () => {
      const ref = this.openPanel()?.ref;
      if (ref) this.nav.open({ kind: 'detail', ref });
    });
    this.logViewer.on('follow-change', () => this.emitContext());

    this.containerDetail.on('error', (msg) => this.emitError(msg));

    this.stackDetail.on('close-request', () => this.nav.open(null));
    this.stackDetail.on('goto', (ref) => this.nav.follow(ref));
    this.stackDetail.on('section', () => this.emitContext());
    this.stackDetail.on('info', (msg) => this.infoHandlers.forEach((h) => h(msg)));
    this.stackDetail.on('error', (msg) => this.emitError(msg));

    this.filterBar.on('change', (query) => {
      this.tree.setFilter(query);
      this.syncCount();
    });
    this.filterBar.on('state', () => this.emitContext());
  }

  on(event: 'context', handler: Handler): void;
  on(event: 'error' | 'info', handler: MessageHandler): void;
  on(event: 'context' | 'error' | 'info', handler: Handler | MessageHandler): void {
    if (event === 'context') this.contextHandlers.push(handler as Handler);
    if (event === 'error') this.errorHandlers.push(handler as MessageHandler);
    if (event === 'info') this.infoHandlers.push(handler as MessageHandler);
  }

  show(): void {
    if (this.active) return;
    this.active = true;
    this.wrapper.show();
    this.tree.focus();

    this.screen.key(['enter'], this.handleEnter);
    this.screen.key(['left'], this.handleLeft);
    this.screen.key(['right'], this.handleRight);
    this.screen.key(['l'], this.handleL);
    this.screen.key(['s'], this.handleS);
    this.screen.key(['r'], this.handleR);
    this.screen.key(['k'], this.handleK);
    this.screen.key(['S-s'], this.handleShiftS);
    this.screen.key(['d'], this.handleD);
    this.screen.key(['x'], this.handleX);

    this.emitContext();
  }

  hide(): void {
    if (!this.active) return;
    this.active = false;
    this.containerDetail.hide();
    this.stackDetail.hide();
    this.logViewer.hide();
    this.confirmDialog.hide();
    this.filterBar.stop();
    this.wrapper.hide();

    this.screen.removeKey('enter', this.handleEnter);
    this.screen.removeKey('left', this.handleLeft);
    this.screen.removeKey('right', this.handleRight);
    this.screen.removeKey('l', this.handleL);
    this.screen.removeKey('s', this.handleS);
    this.screen.removeKey('r', this.handleR);
    this.screen.removeKey('k', this.handleK);
    this.screen.removeKey('S-s', this.handleShiftS);
    this.screen.removeKey('d', this.handleD);
    this.screen.removeKey('x', this.handleX);
  }

  showLoading(): void {
    this.tree.showLoading();
  }

  isOverlayOpen(): boolean {
    return this.isModalOpen() || this.containerDetail.isVisible() || this.stackDetail.isVisible();
  }

  isInert(): boolean {
    return this.confirmDialog.isVisible() || this.filterBar.isEditing();
  }

  location(): Location {
    const key = this.tree.selectionKey();
    const loc: Location = { view: this.view, ...(key ? { selection: key } : {}) };
    const panel = this.openPanel();
    return panel ? { ...loc, panel } : loc;
  }

  restore(loc: Location): boolean {
    const panel = loc.panel;
    if (panel?.ref.kind === 'stack') return this.restoreStack(panel);
    const rowKey = panel ? `c:${panel.ref.id}` : loc.selection;
    if (rowKey !== undefined) this.selectKey(rowKey);

    const target = panel ? this.containers.find((c) => c.id === panel.ref.id) : undefined;
    if (!panel || !target) {
      this.closePanels();
      return !panel;
    }

    this.stackDetail.hide();
    if (panel.kind === 'detail') {
      this.logViewer.hide();
      if (this.containerDetail.getContainerId() !== target.id || !this.containerDetail.isVisible()) {
        this.containerDetail.show(target, this.statsCache.get(target.id));
      }
      this.containerDetail.setFocus(panel.focus);
    } else {
      this.containerDetail.hide();
      if (this.logViewer.getContainerId() !== target.id) this.logViewer.show(target);
    }
    this.emitContext();
    this.screen.render();
    return true;
  }

  /** A stack's detail opens over its header; containers open in the Containers view. */
  has(ref: ResourceRef): boolean {
    return ref.kind === 'stack' && this.stacks.some((s) => s.id === ref.id);
  }

  footerContext(): FooterHints {
    if (this.filterBar.isEditing()) return 'filter';
    if (this.logViewer.isVisible()) return 'log';
    if (this.containerDetail.isVisible()) return this.containerDetail.focusedHints() ?? 'detail';
    if (this.stackDetail.isVisible()) return this.stackDetail.focusedHints() ?? 'stack-detail';
    const context = this.treeContext();
    return this.filterBar.isActive() ? filteredHints(context) : context;
  }

  jumpToStack(stackId: string): void {
    if (this.tree.hiddenByFilter(`s:${stackId}`)) this.filterBar.clear();
    this.tree.jumpToStack(stackId);
  }

  getAggregateStats(): { cpuPercent: number; memUsageMB: number } {
    let cpu = 0;
    let mem = 0;
    for (const c of this.containers) {
      if (!isActive(c.status)) continue;
      const s = this.statsCache.get(c.id);
      if (s) {
        cpu += s.cpuPercent;
        mem += s.memUsageMB;
      }
    }
    return { cpuPercent: cpu, memUsageMB: mem };
  }

  cleanup(): void {
    this.containerDetail.hide();
    this.stackDetail.hide();
    this.logViewer.hide();
    this.confirmDialog.hide();
  }

  setData(containers: ContainerInfo[], stacks: Stack[]): void {
    this.containers = containers;
    this.stacks = stacks;
    this.tree.setData(this.stacks, this.statsCache);
    this.syncCount();

    if (this.containerDetail.isVisible()) {
      const id = this.containerDetail.getContainerId();
      if (id) {
        const updated = containers.find((c) => c.id === id);
        if (updated) this.containerDetail.update(updated, this.statsCache.get(id));
        else {
          // Gone under the panel: close it directly. Not a step the user took, so no history entry.
          this.containerDetail.hide();
          this.tree.focus();
        }
      }
    }
    this.refreshStackDetail();

    this.emitContext();
  }

  /** App's volumes and networks, whenever either listing or the containers change. */
  setResources(volumes: VolumeInfo[], networks: NetworkInfo[]): void {
    this.resources = { volumes, networks };
    this.refreshStackDetail();
  }

  updateStats(id: string, stats: ContainerStats): void {
    this.statsCache.set(id, stats);
    if (this.containerDetail.isVisible() && this.containerDetail.getContainerId() === id) {
      const container = this.containers.find((c) => c.id === id);
      if (container) this.containerDetail.update(container, stats);
    }
  }

  refreshStats(): void {
    this.tree.setData(this.stacks, this.statsCache);
  }

  redraw(): void {
    this.tree.redraw();
    this.syncCount();
  }

  private emitContext(): void {
    this.contextHandlers.forEach((h) => h());
  }

  private treeContext(): FooterContext {
    const sel = this.tree.getSelected();
    if (!sel) return 'global';
    if (sel.kind === 'stack') {
      if (sel.stack.id === NO_STACK) return 'stacks-tree-stack';
      return sel.stack.isLive ? 'stacks-tree-stack-live' : 'stacks-tree-stack-stopped';
    }
    return isActive(sel.container.status) ? 'stacks-tree-running' : 'stacks-tree-stopped';
  }

  private syncCount(): void {
    const { shown, total } = this.tree.matchCount();
    this.filterBar.setCount(shown, total);
  }

  /** A row the filter hides is still where history points: the filter makes way. */
  private selectKey(key: string): void {
    if (this.tree.hiddenByFilter(key)) this.filterBar.clear();
    this.tree.selectKey(key);
  }

  /** The open stack detail on fresh data; gone under it, it closes (not a step the user took). */
  private refreshStackDetail(): void {
    if (!this.stackDetail.isVisible()) return;
    const stack = this.stacks.find((s) => s.id === this.stackDetail.getStackId());
    if (stack) this.stackDetail.update(stack, this.resources);
    else {
      this.stackDetail.hide();
      this.tree.focus();
    }
  }

  private restoreStack(panel: PanelLoc): boolean {
    this.selectKey(`s:${panel.ref.id}`);
    const stack = this.stacks.find((s) => s.id === panel.ref.id);
    if (!stack) {
      this.closePanels();
      return false;
    }
    this.containerDetail.hide();
    this.logViewer.hide();
    if (this.stackDetail.getStackId() !== stack.id || !this.stackDetail.isVisible()) {
      this.stackDetail.show(stack, this.resources);
    }
    this.stackDetail.setFocus(panel.focus);
    this.emitContext();
    this.screen.render();
    return true;
  }

  private openPanel(): PanelLoc | undefined {
    const byId = (id: string | null): ResourceRef | null => {
      const c = this.containers.find((x) => x.id === id);
      return c ? containerRef(c) : id ? { kind: 'container', id } : null;
    };
    if (this.containerDetail.isVisible()) {
      const ref = byId(this.containerDetail.getContainerId());
      const focus = this.containerDetail.getFocus();
      if (ref) return focus ? { kind: 'detail', ref, focus } : { kind: 'detail', ref };
    }
    if (this.logViewer.isVisible()) {
      const ref = byId(this.logViewer.getContainerId());
      if (ref) return { kind: 'logs', ref };
    }
    const stackId = this.stackDetail.isVisible() ? this.stackDetail.getStackId() : null;
    if (stackId !== null) {
      const focus = this.stackDetail.getFocus();
      const ref = stackRef({ id: stackId });
      return focus ? { kind: 'detail', ref, focus } : { kind: 'detail', ref };
    }
    return undefined;
  }

  private closePanels(): void {
    this.containerDetail.hide();
    this.stackDetail.hide();
    this.logViewer.hide();
    this.tree.focus();
    this.emitContext();
    this.screen.render();
  }

  private emitInfo(msg: string): void {
    this.infoHandlers.forEach((h) => h(msg));
  }

  private emitError(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    this.errorHandlers.forEach((h) => h(msg));
  }

  private isModalOpen(): boolean {
    return this.isInert() || this.logViewer.isVisible();
  }

  private readonly handleEnter = () => {
    if (!this.active || this.isOverlayOpen()) return;
    const sel = this.tree.getSelected();
    if (!sel) return;
    // ↵ is detail everywhere; → / ← expand and collapse a stack.
    const ref = sel.kind === 'stack' ? stackRef(sel.stack) : containerRef(sel.container);
    this.nav.open({ kind: 'detail', ref });
  };

  private readonly handleLeft = () => {
    if (!this.active || this.isOverlayOpen()) return;
    this.tree.collapseSelected();
    this.screen.render();
  };

  private readonly handleRight = () => {
    if (!this.active || this.isOverlayOpen()) return;
    this.tree.expandSelected();
    this.screen.render();
  };

  private readonly handleL = () => {
    if (!this.active || this.isModalOpen()) return;
    const c = this.getActionTarget();
    if (c) this.nav.open({ kind: 'logs', ref: containerRef(c) });
  };

  private readonly handleX = () => {
    if (!this.active || this.isModalOpen()) return;
    const c = this.getActionTarget();
    if (!c || c.status !== 'running') {
      if (c) this.emitError(`Cannot exec into ${c.name}: container is not running`);
      return;
    }
    this.closeDetailForAction();
    const result = openExternalShell(c.id);
    if (!result.ok) {
      this.emitError(result.error ?? `Failed to open external terminal for ${c.name}`);
    }
    this.screen.render();
  };

  private readonly handleS = () => {
    if (!this.active || this.isModalOpen()) return;
    const stack = this.getStackTarget();
    if (stack) {
      if (this.isProject(stack) && stack.isLive) this.confirmAndRun(stackStopDialog(stack, this.resources));
      return;
    }
    const c = this.getActionTarget();
    if (!c || !isActive(c.status)) return;
    this.confirmAndRun(containerStopDialog(c));
  };

  private readonly handleR = () => {
    if (!this.active || this.isModalOpen()) return;
    const stack = this.getStackTarget();
    if (stack) {
      if (this.isProject(stack) && stack.isLive) this.confirmAndRun(stackRestartDialog(stack));
      return;
    }
    const c = this.getActionTarget();
    if (!c || !isActive(c.status)) return;
    this.confirmAndRun(containerRestartDialog(c));
  };

  private readonly handleK = () => {
    if (!this.active || this.isModalOpen()) return;
    const stack = this.getStackTarget();
    if (stack) {
      if (this.isProject(stack) && stack.isLive) this.confirmAndRun(stackKillDialog(stack));
      return;
    }
    const c = this.getActionTarget();
    if (!c || !isActive(c.status)) return;
    this.confirmAndRun(containerKillDialog(c));
  };

  private readonly handleShiftS = () => {
    if (!this.active || this.isModalOpen()) return;
    const stack = this.getStackTarget();
    if (stack) {
      if (this.isProject(stack)) this.startStack(stack);
      return;
    }
    const c = this.getActionTarget();
    if (!c) return;
    if (isActive(c.status)) {
      this.emitError(`${c.name} is already ${c.status}`);
      return;
    }
    if (c.status !== 'exited' && c.status !== 'created') {
      this.emitError(`Cannot start ${c.name}: status is ${c.status}`);
      return;
    }
    this.closeDetailForAction();
    this.runAndRefocus(() => startContainer(c.id));
  };

  private readonly handleD = () => {
    if (!this.active || this.isModalOpen()) return;
    const stack = this.getStackTarget();
    if (stack) {
      if (this.isProject(stack)) this.confirmAndRun(stackDownDialog(stack, this.resources));
      return;
    }
    const c = this.getActionTarget();
    if (!c || isActive(c.status)) return;
    this.confirmAndRun(containerRemoveDialog(c));
  };

  /** `compose start`: no confirm, like starting a container. */
  private startStack(stack: Stack): void {
    const start = stackStart(stack);
    if (!start) {
      this.emitError(`Every service in ${stack.id} is already running`);
      return;
    }
    this.closeDetailForAction();
    this.emitInfo(`Starting ${start.count === 1 ? '1 service' : `${start.count} services`} in ${stack.id}…`);
    this.runAndRefocus(start.run);
  }

  /** The stack a key acts on: the open stack detail's, else the selected header's. */
  private getStackTarget(): Stack | null {
    if (this.containerDetail.isVisible()) return null;
    if (this.stackDetail.isVisible()) {
      return this.stacks.find((s) => s.id === this.stackDetail.getStackId()) ?? null;
    }
    const sel = this.tree.getSelected();
    return sel?.kind === 'stack' ? sel.stack : null;
  }

  /** `(no stack)` gathers containers compose didn't create: there's no project to act on as one. */
  private isProject(stack: Stack): boolean {
    if (stack.id !== NO_STACK) return true;
    this.emitError('These containers are not a compose project: act on them one by one');
    return false;
  }

  /** Container targeted by tree/detail actions (detail takes precedence when open). */
  private getActionTarget(): ContainerInfo | null {
    // A stack's detail has no container to act on.
    if (this.stackDetail.isVisible()) return null;
    if (this.containerDetail.isVisible()) {
      const id = this.containerDetail.getContainerId();
      if (id) return this.containers.find((c) => c.id === id) ?? null;
    }
    const sel = this.tree.getSelected();
    if (!sel || sel.kind !== 'service') return null;
    return sel.container;
  }

  /** An action that leaves the detail panel (confirm, start, shell) closes it: a history step like Esc. */
  private closeDetailForAction(): void {
    if (this.containerDetail.isVisible() || this.stackDetail.isVisible()) this.nav.open(null);
  }

  private confirmAndRun(dialog: ActionDialog): void {
    this.closeDetailForAction();
    this.confirmDialog.choose({
      ...dialog,
      choices: dialog.choices.map(({ pending, run, also, ...choice }) => ({
        ...choice,
        onPick: () => {
          if (pending) this.emitInfo(pending);
          this.runAndRefocus(run, also);
        },
      })),
      onCancel: () => {
        this.tree.focus();
        this.screen.render();
      },
    });
  }

  private runAndRefocus(action: () => Promise<void>, also?: AlsoChanges): void {
    void this.runMutation(action, also)
      .catch((err: unknown) => this.emitError(err))
      .finally(() => {
        this.tree.focus();
        this.screen.render();
      });
  }
}
