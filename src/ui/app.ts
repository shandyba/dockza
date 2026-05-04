import blessed from 'neo-blessed';
import { getDockerSocketLabel, getDockerVersion } from '@docker/client';
import { listContainers, fetchStats } from '@docker/containers';
import { listImages } from '@docker/images';
import { listVolumes } from '@docker/volumes';
import type { ContainerInfo } from '@models/docker';
import { groupIntoStacks, type Stack } from '@utils/stacks';
import { isActive } from '@utils/status';
import { TopBar } from '@ui/top-bar';
import { Footer } from '@ui/footer';
import type { FooterContext } from '@ui/footer';
import { SideRail, RAIL_WIDTH, type ViewId } from '@ui/side-rail';
import { HelpOverlay } from '@ui/help-overlay';
import { StacksTab } from '@ui/stacks/stacks-tab';
import type { StackTreeSelection } from '@ui/stacks/stack-tree';
import { ContainersTab } from '@ui/containers/containers-tab';
import { ImagesTab } from '@ui/images/images-tab';
import { VolumesTab } from '@ui/volumes/volumes-tab';

const VIEW_ORDER: ViewId[] = ['stacks', 'containers', 'images', 'volumes'];

export class App {
  private screen: blessed.Widgets.Screen;
  private topBar: TopBar;
  private footer: Footer;
  private rail: SideRail;
  private helpOverlay: HelpOverlay;

  private stacksTab: StacksTab;
  private containersTab: ContainersTab;
  private imagesTab: ImagesTab;
  private volumesTab: VolumesTab;

  private activeView: ViewId = 'stacks';
  private overlayOpen = false;

  private containers: ContainerInfo[] = [];
  private stacks: Stack[] = [];
  private imageCount = 0;
  private volumeCount = 0;
  private aggregateStats: { cpuPercent: number; memUsageMB: number } | null = null;

  private pollTimers: NodeJS.Timeout[] = [];
  private footerMsgTimer: NodeJS.Timeout | null = null;
  private exitResolve: (() => void) | null = null;
  private pollingContainers = false;
  private pollingImagesVolumes = false;
  private pollingStats = false;

  constructor() {
    this.screen = blessed.screen({
      smartCSR: true,
      mouse: true,
      fullUnicode: true,
      title: 'docktui',
      terminal: 'xterm-256color',
    });

    const tabDims = {
      top: 1,
      left: RAIL_WIDTH,
      width: `100%-${RAIL_WIDTH}`,
      height: '100%-2',
    };

    this.topBar = new TopBar(this.screen);
    this.footer = new Footer(this.screen);
    this.rail = new SideRail(this.screen);
    this.helpOverlay = new HelpOverlay(this.screen);

    this.stacksTab = new StacksTab(this.screen, tabDims);
    this.containersTab = new ContainersTab(this.screen, tabDims);
    this.imagesTab = new ImagesTab(this.screen, tabDims);
    this.volumesTab = new VolumesTab(this.screen, tabDims);

    this.wireEvents();
    this.setupKeys();

    this.screen.on('destroy', () => this.stopPolling());
    this.screen.on('resize', () => this.handleResize());

    const externalShutdown = () => this.shutdown();
    process.once('SIGTERM', externalShutdown);
    process.once('SIGHUP', externalShutdown);
  }

  private wireEvents(): void {
    this.helpOverlay.on('hide', () => {
      this.overlayOpen = false;
      this.render();
    });

    this.rail.on('view-change', (id) => {
      if (!this.canSwitchView()) return;
      this.showView(id);
    });

    this.rail.on('stack-jump', (stackId) => {
      if (!this.canSwitchView()) return;
      this.showView('stacks');
      this.stacksTab.jumpToStack(stackId);
      this.render();
    });

    this.stacksTab.on('error', (msg) => this.setFooterMessage(msg, 'red'));
    this.stacksTab.on('stack-update', (stacks) => {
      this.stacks = stacks;
      this.rail.setStacks(stacks);
      this.refreshTopBarCounters();
    });
    this.stacksTab.on('navigate', (sel) => {
      if (this.activeView !== 'stacks') return;
      this.footer.setContext(this.contextForStacks(sel));
      this.render();
    });
    this.stacksTab.on('detail-open', () => {
      if (this.activeView === 'stacks') {
        this.footer.setContext('detail');
        this.render();
      }
    });
    this.stacksTab.on('log-open', () => {
      if (this.activeView === 'stacks') {
        this.footer.setContext('log');
        this.render();
      }
    });
    this.stacksTab.on('log-follow-change', () => {
      if (this.activeView === 'stacks') {
        this.footer.setContext('log');
        this.render();
      }
    });

    this.containersTab.on('error', (msg) => this.setFooterMessage(msg, 'red'));
    this.containersTab.on('select', (c) => {
      if (this.activeView !== 'containers') return;
      this.footer.setContext(this.contextForContainer(c));
      this.render();
    });
    this.containersTab.on('detail-open', () => {
      if (this.activeView === 'containers') {
        this.footer.setContext('detail');
        this.render();
      }
    });
    this.containersTab.on('log-open', () => {
      if (this.activeView === 'containers') {
        this.footer.setContext('log');
        this.render();
      }
    });
    this.containersTab.on('log-follow-change', () => {
      if (this.activeView === 'containers') {
        this.footer.setContext('log');
        this.render();
      }
    });

    this.imagesTab.on('error', (msg) => this.setFooterMessage(msg, 'red'));
    this.imagesTab.on('navigate', () => {
      if (this.activeView === 'images') {
        this.footer.setContext('images');
        this.render();
      }
    });

    this.volumesTab.on('error', (msg) => this.setFooterMessage(msg, 'red'));
    this.volumesTab.on('navigate', () => {
      if (this.activeView === 'volumes') {
        this.footer.setContext('volumes');
        this.render();
      }
    });
  }

  private contextForStacks(sel: StackTreeSelection): FooterContext {
    if (!sel) return 'global';
    if (sel.kind === 'stack') return 'stacks-tree-stack';
    return isActive(sel.container.status) ? 'stacks-tree-running' : 'stacks-tree-stopped';
  }

  private contextForContainer(c: ContainerInfo | null): FooterContext {
    if (!c) return 'containers-empty';
    return isActive(c.status) ? 'containers-running' : 'containers-stopped';
  }

  private setupKeys(): void {
    this.screen.key('tab', () => {
      if (!this.canSwitchView()) return;
      const idx = (VIEW_ORDER.indexOf(this.activeView) + 1) % VIEW_ORDER.length;
      this.showView(VIEW_ORDER[idx]);
    });

    this.screen.key('S-tab', () => {
      if (!this.canSwitchView()) return;
      const idx = (VIEW_ORDER.indexOf(this.activeView) + VIEW_ORDER.length - 1) % VIEW_ORDER.length;
      this.showView(VIEW_ORDER[idx]);
    });

    for (let i = 0; i < VIEW_ORDER.length; i++) {
      const view = VIEW_ORDER[i];
      this.screen.key(String(i + 1), () => {
        if (!this.canSwitchView()) return;
        this.showView(view);
      });
    }

    this.screen.key('?', () => {
      if (this.isModalOpen()) return;
      if (this.overlayOpen) {
        this.helpOverlay.hide();
      } else {
        this.overlayOpen = true;
        this.helpOverlay.show();
      }
    });

    this.screen.key(['q', 'C-c'], () => {
      if (this.overlayOpen || this.isConfirmOpen() || this.isFilterOpen()) return;
      this.shutdown();
    });
  }

  private canSwitchView(): boolean {
    return !this.overlayOpen && !this.isModalOpen();
  }

  private isModalOpen(): boolean {
    return (
      this.stacksTab.isOverlayOpen() ||
      this.containersTab.isOverlayOpen() ||
      this.imagesTab.isConfirmOpen() ||
      this.volumesTab.isConfirmOpen() ||
      this.isFilterOpen()
    );
  }

  private isConfirmOpen(): boolean {
    return (
      this.stacksTab.isConfirmOpen() ||
      this.containersTab.isConfirmOpen() ||
      this.imagesTab.isConfirmOpen() ||
      this.volumesTab.isConfirmOpen()
    );
  }

  private isFilterOpen(): boolean {
    return this.stacksTab.isFilterOpen();
  }

  private showView(id: ViewId): void {
    if (this.activeView === id) return;

    this.hideTab(this.activeView);
    this.activeView = id;
    this.showTab(id);

    this.rail.setActiveView(id);
    this.footer.setContext(this.defaultContextFor(id));
    this.render();
  }

  private hideTab(id: ViewId): void {
    switch (id) {
      case 'stacks':
        this.stacksTab.hide();
        break;
      case 'containers':
        this.containersTab.hide();
        break;
      case 'images':
        this.imagesTab.hide();
        break;
      case 'volumes':
        this.volumesTab.hide();
        break;
    }
  }

  private showTab(id: ViewId): void {
    switch (id) {
      case 'stacks':
        this.stacksTab.show();
        break;
      case 'containers':
        this.containersTab.show();
        break;
      case 'images':
        this.imagesTab.show();
        break;
      case 'volumes':
        this.volumesTab.show();
        break;
    }
  }

  private defaultContextFor(id: ViewId): FooterContext {
    switch (id) {
      case 'stacks':
        return this.contextForStacks(this.stacksTab.getSelected());
      case 'containers':
        return this.contextForContainer(this.containersTab.getSelected());
      case 'images':
        return 'images';
      case 'volumes':
        return 'volumes';
    }
  }

  private render(): void {
    this.screen.render();
  }

  setFooterMessage(text: string, color: 'red' | 'green' | 'normal', duration = 3000): void {
    if (this.footerMsgTimer) clearTimeout(this.footerMsgTimer);
    this.footer.setMessage({ text, color });
    this.render();
    this.footerMsgTimer = setTimeout(() => {
      this.footerMsgTimer = null;
      this.footer.setMessage(null);
      this.render();
    }, duration);
  }

  async start(): Promise<void> {
    const dockerVersion = await getDockerVersion();

    this.topBar.setSocketPath(getDockerSocketLabel());
    this.topBar.setDockerVersion(dockerVersion);
    this.topBar.setCounters({ running: 0, errored: 0, stopped: 0 });
    this.topBar.render();

    this.rail.setActiveView('stacks');
    this.rail.setCounts({ stacks: 0, containers: 0, images: 0, volumes: 0 });

    this.footer.setContext('global');
    this.footer.startTicker(() => this.render());

    this.stacksTab.showLoading();
    this.containersTab.showLoading();
    this.imagesTab.showLoading();
    this.volumesTab.showLoading();

    this.showTab('stacks');
    this.render();

    await this.pollContainers();
    await this.pollImagesAndVolumes();

    this.pollTimers.push(
      setInterval(() => {
        void this.pollContainers();
      }, 5000),
      setInterval(() => {
        void this.pollImagesAndVolumes();
      }, 10000),
      setInterval(() => {
        void this.pollStats();
      }, 2000),
    );

    return new Promise<void>((resolve) => {
      this.exitResolve = resolve;
    });
  }

  private async pollContainers(): Promise<void> {
    if (this.pollingContainers) return;
    this.pollingContainers = true;
    try {
      const containers = await listContainers();
      this.containers = containers;
      this.stacks = groupIntoStacks(containers);
      this.stacksTab.setData(containers, this.stacks);
      this.containersTab.setData(containers);
      this.rail.setStacks(this.stacks);
      this.refreshTopBarCounters();
      this.refreshRailCounts();
      this.footer.noteRefresh();
      this.render();
    } catch (err) {
      this.setFooterMessage(err instanceof Error ? err.message : String(err), 'red');
    } finally {
      this.pollingContainers = false;
    }
  }

  private async pollImagesAndVolumes(): Promise<void> {
    if (this.pollingImagesVolumes) return;
    this.pollingImagesVolumes = true;
    try {
      const [images, volumes] = await Promise.all([listImages(), listVolumes()]);
      this.imageCount = images.length;
      this.volumeCount = volumes.length;
      this.imagesTab.setData(images);
      this.volumesTab.setData(volumes);
      this.refreshRailCounts();
      this.footer.noteRefresh();
      this.render();
    } catch (err) {
      this.setFooterMessage(err instanceof Error ? err.message : String(err), 'red');
    } finally {
      this.pollingImagesVolumes = false;
    }
  }

  private async pollStats(): Promise<void> {
    if (this.pollingStats) return;
    this.pollingStats = true;
    try {
      await this.doPollStats();
    } finally {
      this.pollingStats = false;
    }
  }

  private async doPollStats(): Promise<void> {
    const running = this.containers.filter((c) => isActive(c.status));
    await Promise.allSettled(
      running.map(async (c) => {
        try {
          const stats = await fetchStats(c.id);
          this.stacksTab.updateStats(c.id, stats);
          this.containersTab.updateStats(c.id, stats);
        } catch {
          // ignore per-container stats errors
        }
      }),
    );
    if (running.length > 0) {
      this.aggregateStats = this.stacksTab.getAggregateStats();
      this.stacksTab.refreshStats();
      this.containersTab.refreshListStats();
      this.topBar.setStats(this.aggregateStats);
      this.footer.noteRefresh();
    } else {
      this.aggregateStats = null;
      this.topBar.setStats(null);
    }
    this.render();
  }

  private refreshTopBarCounters(): void {
    let running = 0;
    let errored = 0;
    let stopped = 0;
    for (const c of this.containers) {
      if (c.status === 'running' || c.status === 'paused' || c.status === 'restarting') running++;
      else if ((c.status === 'exited' || c.status === 'dead') && c.exitCode !== 0) errored++;
      else stopped++;
    }
    this.topBar.setCounters({ running, errored, stopped });
  }

  private refreshRailCounts(): void {
    this.rail.setCounts({
      stacks: this.stacks.length,
      containers: this.containers.length,
      images: this.imageCount,
      volumes: this.volumeCount,
    });
  }

  private handleResize(): void {
    this.stacksTab.redraw();
    this.containersTab.setData(this.containers);
    this.imagesTab.redraw();
    this.volumesTab.redraw();
    this.topBar.render();
    this.footer.render();
    this.render();
  }

  private stopPolling(): void {
    for (const timer of this.pollTimers) clearInterval(timer);
    this.pollTimers = [];
    this.footer.stopTicker();
  }

  private shutdown(): void {
    this.stopPolling();
    if (this.footerMsgTimer) {
      clearTimeout(this.footerMsgTimer);
      this.footerMsgTimer = null;
    }
    this.stacksTab.cleanup();
    this.containersTab.cleanup();
    this.screen.destroy();
    if (this.exitResolve) {
      const resolve = this.exitResolve;
      this.exitResolve = null;
      resolve();
    }
  }
}
