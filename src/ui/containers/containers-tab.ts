import type blessed from 'neo-blessed';
import { startContainer } from '@docker/containers';
import type { ContainerInfo, ContainerStats } from '@models/docker';
import type { Location, PanelLoc, ResourceRef } from '@models/nav';
import { t } from '@theme';
import { containerFilterFields, filterItems } from '@utils/filter';
import { escapeTags } from '@utils/format';
import { containerRef } from '@utils/nav-history';
import { isActive } from '@utils/status';
import { openExternalShell } from '@utils/external-terminal';
import { ContainerList } from '@ui/containers/container-list';
import type { RowStats } from '@ui/containers/container-list';
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
import { filteredHints, type FooterHints } from '@ui/footer';
import type { TabNav, ViewTab } from '@ui/view-tab';
import type { Dims, RunMutation } from '@ui/widgets';

type Handler = () => void;
type MessageHandler = (message: string) => void;

export class ContainersTab implements ViewTab {
  readonly view = 'containers' as const;
  private screen: blessed.Widgets.Screen;
  private containerList: ContainerList;
  private containerDetail: ContainerDetail;
  private confirmDialog: ConfirmDialog;
  private logViewer: LogViewer;
  private filterBar: FilterBar;

  private containers: ContainerInfo[] = [];
  /** What the filter lets through, row for row with the list; `selectedIndex` indexes it. */
  private shown: ContainerInfo[] = [];
  private selectedIndex = 0;
  private active = false;
  private statsCache = new Map<string, ContainerStats>();

  private contextHandlers: Handler[] = [];
  private errorHandlers: MessageHandler[] = [];
  private infoHandlers: MessageHandler[] = [];

  private readonly handleEnter = () => {
    if (!this.active || this.isOverlayOpen()) return;
    const c = this.containerList.getSelected();
    if (c) this.nav.open({ kind: 'detail', ref: containerRef(c) });
  };

  private readonly handleL = () => {
    if (!this.active || this.isModalOpen()) return;
    const c = this.getActionTarget();
    if (c) this.nav.open({ kind: 'logs', ref: containerRef(c) });
  };

  private confirmAndRun(dialog: ActionDialog): void {
    this.closeDetailForAction();
    const done = () => {
      this.containerList.focus();
      this.screen.render();
    };
    this.confirmDialog.choose({
      ...dialog,
      choices: dialog.choices.map((choice) => ({
        ...choice,
        onPick: () => {
          void this.runMutation(choice.run, choice.also)
            .catch((err: unknown) => this.emitError(err))
            .finally(done);
        },
      })),
      onCancel: done,
    });
  }

  private readonly handleS = () => {
    if (!this.active || this.isModalOpen()) return;
    const c = this.getActionTarget();
    if (!c || !isActive(c.status)) return;
    this.confirmAndRun(containerStopDialog(c));
  };

  private readonly handleR = () => {
    if (!this.active || this.isModalOpen()) return;
    const c = this.getActionTarget();
    if (!c || !isActive(c.status)) return;
    this.confirmAndRun(containerRestartDialog(c));
  };

  private readonly handleK = () => {
    if (!this.active || this.isModalOpen()) return;
    const c = this.getActionTarget();
    if (!c || !isActive(c.status)) return;
    this.confirmAndRun(containerKillDialog(c));
  };

  private readonly handleShiftS = () => {
    if (!this.active || this.isModalOpen()) return;
    const c = this.getActionTarget();
    if (!c) {
      this.emitError('No container selected');
      return;
    }
    if (isActive(c.status)) {
      this.emitError(`${c.name} is already ${c.status}`);
      return;
    }
    if (c.status !== 'exited' && c.status !== 'created') {
      this.emitError(`Cannot start ${c.name}: status is ${c.status}`);
      return;
    }
    this.closeDetailForAction();
    void this.runMutation(() => startContainer(c.id))
      .catch((err: unknown) => this.emitError(err))
      .finally(() => {
        this.containerList.focus();
        this.screen.render();
      });
  };

  private readonly handleD = () => {
    if (!this.active || this.isModalOpen()) return;
    const c = this.getActionTarget();
    if (!c || isActive(c.status)) return;
    this.confirmAndRun(containerRemoveDialog(c));
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

  constructor(
    screen: blessed.Widgets.Screen,
    dims: Dims,
    private readonly runMutation: RunMutation,
    private readonly nav: TabNav,
  ) {
    this.screen = screen;

    this.containerList = new ContainerList(screen, dims);
    this.containerDetail = new ContainerDetail(screen, dims);
    this.confirmDialog = new ConfirmDialog(screen);
    this.logViewer = new LogViewer(screen, dims);
    this.filterBar = new FilterBar(screen, this.containerList.list);

    this.containerList.on('select', (container) => {
      const idx = this.shown.findIndex((c) => c.id === container.id);
      if (idx >= 0) this.selectedIndex = idx;
    });

    this.filterBar.on('change', () => {
      this.renderList();
      this.emitContext();
    });
    this.filterBar.on('state', () => this.emitContext());

    this.containerList.on('navigate', () => this.emitContext());

    this.containerDetail.on('close-request', () => this.nav.open(null));
    this.containerDetail.on('goto', (ref) => this.nav.follow(ref));
    this.containerDetail.on('section', () => this.emitContext());
    this.containerDetail.on('info', (msg) => this.infoHandlers.forEach((h) => h(msg)));
    this.containerDetail.on('error', (msg) => this.emitError(msg));

    this.logViewer.on('close-request', () => this.nav.open(null));
    this.logViewer.on('detail-request', () => {
      const ref = this.openPanel()?.ref;
      if (ref) this.nav.open({ kind: 'detail', ref });
    });
    this.logViewer.on('follow-change', () => this.emitContext());

    this.containerList.hide();
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
    this.containerList.show();
    this.containerList.focus();

    this.screen.key(['enter'], this.handleEnter);
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
    this.filterBar.stop();
    this.containerList.hide();
    this.containerDetail.hide();
    this.logViewer.hide();
    this.confirmDialog.hide();

    this.screen.removeKey('enter', this.handleEnter);
    this.screen.removeKey('l', this.handleL);
    this.screen.removeKey('s', this.handleS);
    this.screen.removeKey('r', this.handleR);
    this.screen.removeKey('k', this.handleK);
    this.screen.removeKey('S-s', this.handleShiftS);
    this.screen.removeKey('d', this.handleD);
    this.screen.removeKey('x', this.handleX);
  }

  showLoading(): void {
    this.containerList.showLoading();
  }

  isOverlayOpen(): boolean {
    return this.isModalOpen() || this.containerDetail.isVisible();
  }

  isInert(): boolean {
    return this.confirmDialog.isVisible() || this.filterBar.isEditing();
  }

  getSelected(): ContainerInfo | null {
    return this.containerList.getSelected();
  }

  location(): Location {
    const selected = this.containerList.getSelected();
    const loc: Location = { view: this.view, ...(selected ? { selection: selected.id } : {}) };
    const panel = this.openPanel();
    return panel ? { ...loc, panel } : loc;
  }

  restore(loc: Location): boolean {
    const panel = loc.panel;
    const rowId = panel?.ref.id ?? loc.selection;
    if (rowId !== undefined) this.selectRow(rowId);

    const target = panel ? this.containers.find((c) => c.id === panel.ref.id) : undefined;
    if (!panel || !target) {
      this.closePanels();
      return !panel;
    }

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

  has(ref: ResourceRef): boolean {
    return ref.kind === 'container' && this.containers.some((c) => c.id === ref.id);
  }

  footerContext(): FooterHints {
    if (this.filterBar.isEditing()) return 'filter';
    if (this.logViewer.isVisible()) return 'log';
    if (this.containerDetail.isVisible()) return this.containerDetail.focusedHints() ?? 'detail';
    const c = this.containerList.getSelected();
    const context = !c
      ? 'containers-empty'
      : isActive(c.status)
        ? 'containers-running'
        : 'containers-stopped';
    return this.filterBar.isActive() ? filteredHints(context) : context;
  }

  cleanup(): void {
    this.logViewer.hide();
    this.containerDetail.hide();
    this.confirmDialog.hide();
  }

  refreshListStats(): void {
    this.renderList();
  }

  /** Re-render the current dataset (useful after terminal resize). */
  redraw(): void {
    this.setData(this.containers);
  }

  setData(containers: ContainerInfo[]): void {
    this.containers = containers;
    this.renderList();

    if (this.containerDetail.isVisible()) {
      const detailId = this.containerDetail.getContainerId();
      const updated = containers.find((c) => c.id === detailId);
      if (updated) {
        this.containerDetail.update(updated, this.statsCache.get(updated.id));
      } else {
        // Gone under the panel: close it directly. Not a step the user took, so no history entry.
        this.containerDetail.hide();
        this.containerList.focus();
      }
    }

    this.emitContext();
  }

  updateStats(id: string, stats: ContainerStats): void {
    this.statsCache.set(id, stats);

    if (this.containerDetail.isVisible() && this.containerDetail.getContainerId() === id) {
      const container = this.containers.find((c) => c.id === id);
      if (container) this.containerDetail.update(container, stats);
    }
  }

  private isModalOpen(): boolean {
    return this.isInert() || this.logViewer.isVisible();
  }

  /** The rows the filter lets through, the cursor on the same container (or the top when it's gone). */
  private renderList(): void {
    const cursorId = this.containerList.getSelected()?.id ?? this.shown[this.selectedIndex]?.id;
    const query = this.filterBar.query();
    this.shown = filterItems(this.containers, query, containerFilterFields);

    if (cursorId) {
      const newIdx = this.shown.findIndex((c) => c.id === cursorId);
      this.selectedIndex = newIdx >= 0 ? newIdx : 0;
    }
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.shown.length - 1));

    const listStats = new Map<string, RowStats>();
    for (const c of this.shown) {
      const s = this.statsCache.get(c.id);
      if (s) listStats.set(c.id, { cpuPercent: s.cpuPercent, memPercent: s.memPercent });
    }

    const empty =
      this.containers.length === 0 ? 'No containers' : `No matches for ${t.fg(escapeTags(query.trim()))}`;
    const targetIdx = this.selectedIndex;
    this.containerList.setData(this.shown, listStats, empty);
    this.containerList.list.select(targetIdx);
    this.filterBar.setCount(this.shown.length, this.containers.length);
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
    return undefined;
  }

  /** A row the filter hides is still where history or a link points: the filter makes way. */
  private selectRow(id: string): void {
    const hidden = !this.shown.some((c) => c.id === id) && this.containers.some((c) => c.id === id);
    if (hidden) this.filterBar.clear();
    const idx = this.shown.findIndex((c) => c.id === id);
    if (idx < 0) return;
    this.selectedIndex = idx;
    this.containerList.list.select(idx);
  }

  private closePanels(): void {
    this.containerDetail.hide();
    this.logViewer.hide();
    this.containerList.focus();
    this.emitContext();
    this.screen.render();
  }

  /** Container targeted by list/detail actions (detail takes precedence when open). */
  private getActionTarget(): ContainerInfo | null {
    if (this.containerDetail.isVisible()) {
      const id = this.containerDetail.getContainerId();
      if (id) return this.containers.find((c) => c.id === id) ?? null;
    }
    return this.containerList.getSelected();
  }

  /** An action that leaves the detail panel (confirm, start, shell) closes it: a history step like Esc. */
  private closeDetailForAction(): void {
    if (this.containerDetail.isVisible()) this.nav.open(null);
  }

  private emitContext(): void {
    this.contextHandlers.forEach((h) => h());
  }

  private emitError(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    this.errorHandlers.forEach((h) => h(msg));
  }
}
