import blessed from 'neo-blessed';
import { getDockerSocketLabel, getDockerVersion } from '@docker/client';
import { listContainers, fetchStats } from '@docker/containers';
import { listImages } from '@docker/images';
import { listVolumes } from '@docker/volumes';
import { listNetworks } from '@docker/networks';
import type { ContainerInfo } from '@models/docker';
import { groupIntoStacks, type Stack } from '@utils/stacks';
import { isActive } from '@utils/status';
import { RefreshGate } from '@utils/refresh-gate';
import { TopBar } from '@ui/top-bar';
import { Footer } from '@ui/footer';
import type { FooterContext } from '@ui/footer';
import { SideRail, RAIL_WIDTH, type ViewId } from '@ui/side-rail';
import type { RunMutation } from '@ui/widgets';
import { HelpOverlay } from '@ui/help-overlay';
import { StacksTab } from '@ui/stacks/stacks-tab';
import type { StackTreeSelection } from '@ui/stacks/stack-tree';
import { ContainersTab } from '@ui/containers/containers-tab';
import { ImagesTab } from '@ui/images/images-tab';
import { VolumesTab } from '@ui/volumes/volumes-tab';
import { NetworksTab } from '@ui/networks/networks-tab';

const VIEW_ORDER: ViewId[] = ['stacks', 'containers', 'images', 'volumes', 'networks'];

const msgOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

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
  private networksTab: NetworksTab;

  private activeView: ViewId = 'stacks';
  private overlayOpen = false;

  private containers: ContainerInfo[] = [];
  private stacks: Stack[] = [];
  private imageCount = 0;
  private volumeCount = 0;
  private networkCount = 0;
  private aggregateStats: { cpuPercent: number; memUsageMB: number } | null = null;

  private pollTimers: NodeJS.Timeout[] = [];
  private footerMsgTimer: NodeJS.Timeout | null = null;
  private exitResolve: (() => void) | null = null;
  private pollingStats = false;

  // One gate per listing so a mutation only invalidates the data it can affect — deleting an
  // image must not force a `listVolumes()` (which pays for a `docker system df`), and a slow
  // listing can no longer delay the others the way the old shared `allSettled` did.
  private readonly containersGate = new RefreshGate((token) => this.fetchContainers(token));
  private readonly imagesGate = new RefreshGate((token) => this.fetchImages(token));
  private readonly volumesGate = new RefreshGate((token) => this.fetchVolumes(token));
  private readonly networksGate = new RefreshGate((token) => this.fetchNetworks(token));

  constructor() {
    this.screen = blessed.screen({
      smartCSR: true,
      mouse: true,
      fullUnicode: true,
      title: 'dockza',
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

    const onContainers = this.mutationRunner(this.containersGate);
    this.stacksTab = new StacksTab(this.screen, tabDims, onContainers);
    this.containersTab = new ContainersTab(this.screen, tabDims, onContainers);
    this.imagesTab = new ImagesTab(this.screen, tabDims, this.mutationRunner(this.imagesGate));
    this.volumesTab = new VolumesTab(this.screen, tabDims, this.mutationRunner(this.volumesGate));
    this.networksTab = new NetworksTab(this.screen, tabDims, this.mutationRunner(this.networksGate));

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

    this.networksTab.on('error', (msg) => this.setFooterMessage(msg, 'red'));
    this.networksTab.on('navigate', () => {
      if (this.activeView === 'networks') {
        this.footer.setContext('networks');
        this.render();
      }
    });
  }

  /**
   * How every tab runs a docker mutation. Invalidating on both sides of the action is what
   * stops a deleted row coming back: the leading `invalidate` kills fetches issued *before*
   * the mutation, and `force` kills those issued *during* it before re-reading the truth.
   */
  private mutationRunner(gate: RefreshGate): RunMutation {
    return async (action) => {
      gate.invalidate();
      try {
        await action();
      } finally {
        await gate.force();
      }
    };
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

  private readonly toggleHelp = (): void => {
    if (this.overlayOpen) {
      this.helpOverlay.hide();
      return;
    }
    if (this.isHelpBlocked()) return;
    this.overlayOpen = true;
    this.helpOverlay.show();
  };

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

    this.screen.key(['h'], this.toggleHelp);

    this.screen.key(['q', 'C-c'], () => {
      if (this.overlayOpen || this.isModalOpen()) return;
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
      this.networksTab.isConfirmOpen() ||
      this.isFilterOpen()
    );
  }

  private isFilterOpen(): boolean {
    return this.stacksTab.isFilterOpen();
  }

  private isHelpBlocked(): boolean {
    return (
      this.stacksTab.isConfirmOpen() ||
      this.containersTab.isConfirmOpen() ||
      this.imagesTab.isConfirmOpen() ||
      this.volumesTab.isConfirmOpen() ||
      this.networksTab.isConfirmOpen() ||
      this.isFilterOpen()
    );
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
      case 'networks':
        this.networksTab.hide();
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
      case 'networks':
        this.networksTab.show();
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
      case 'networks':
        return 'networks';
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
    this.rail.setCounts({ stacks: 0, containers: 0, images: 0, volumes: 0, networks: 0 });

    this.footer.setContext('global');
    this.footer.startTicker(() => this.render());

    this.stacksTab.showLoading();
    this.containersTab.showLoading();
    this.imagesTab.showLoading();
    this.volumesTab.showLoading();
    this.networksTab.showLoading();

    this.showTab('stacks');
    this.render();

    await this.containersGate.poll();
    await Promise.all(this.resourceGates().map((gate) => gate.poll()));

    this.pollTimers.push(
      setInterval(() => {
        void this.containersGate.poll();
      }, 5000),
      setInterval(() => {
        for (const gate of this.resourceGates()) void gate.poll();
      }, 10000),
      setInterval(() => {
        void this.pollStats();
      }, 2000),
    );

    return new Promise<void>((resolve) => {
      this.exitResolve = resolve;
    });
  }

  private resourceGates(): RefreshGate[] {
    return [this.imagesGate, this.volumesGate, this.networksGate];
  }

  private async fetchContainers(token: number): Promise<void> {
    try {
      const containers = await listContainers();
      if (!this.containersGate.isCurrent(token)) return;
      this.applyContainers(containers);
    } catch (err) {
      if (!this.containersGate.isCurrent(token)) return;
      this.setFooterMessage(msgOf(err), 'red');
    }
  }

  private applyContainers(containers: ContainerInfo[]): void {
    this.containers = containers;
    this.stacks = groupIntoStacks(containers);
    this.stacksTab.setData(containers, this.stacks);
    this.containersTab.setData(containers);
    this.rail.setStacks(this.stacks);
    this.refreshTopBarCounters();
    this.refreshRailCounts();
    this.footer.noteRefresh();
    this.render();
  }

  private async fetchImages(token: number): Promise<void> {
    try {
      const images = await listImages();
      if (!this.imagesGate.isCurrent(token)) return;
      this.imageCount = images.length;
      this.imagesTab.setData(images);
      this.afterResourceFetch();
    } catch (err) {
      if (!this.imagesGate.isCurrent(token)) return;
      this.setFooterMessage(msgOf(err), 'red');
    }
  }

  private async fetchVolumes(token: number): Promise<void> {
    try {
      const volumes = await listVolumes();
      if (!this.volumesGate.isCurrent(token)) return;
      this.volumeCount = volumes.length;
      this.volumesTab.setData(volumes);
      this.afterResourceFetch();
    } catch (err) {
      if (!this.volumesGate.isCurrent(token)) return;
      this.setFooterMessage(msgOf(err), 'red');
    }
  }

  private async fetchNetworks(token: number): Promise<void> {
    try {
      const networks = await listNetworks();
      if (!this.networksGate.isCurrent(token)) return;
      this.networkCount = networks.length;
      this.networksTab.setData(networks);
      this.afterResourceFetch();
    } catch (err) {
      if (!this.networksGate.isCurrent(token)) return;
      this.setFooterMessage(msgOf(err), 'red');
    }
  }

  private afterResourceFetch(): void {
    this.refreshRailCounts();
    this.footer.noteRefresh();
    this.render();
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
      networks: this.networkCount,
    });
  }

  private handleResize(): void {
    this.stacksTab.redraw();
    this.containersTab.redraw();
    this.imagesTab.redraw();
    this.volumesTab.redraw();
    this.networksTab.redraw();
    this.topBar.render();
    this.footer.render();
    this.render();
  }

  private stopPolling(): void {
    for (const timer of this.pollTimers) clearInterval(timer);
    this.pollTimers = [];
    // Neutralize in-flight fetches so none of them renders into a destroyed screen.
    this.containersGate.invalidate();
    for (const gate of this.resourceGates()) gate.invalidate();
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
