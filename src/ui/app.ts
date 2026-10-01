import blessed from 'neo-blessed';
import { getDockerSocketLabel, getDockerVersion } from '@docker/client';
import { listContainers, fetchStats } from '@docker/containers';
import { inspectImage, listImages } from '@docker/images';
import { listVolumes } from '@docker/volumes';
import { listNetworks } from '@docker/networks';
import type { ContainerInfo, ImageInfo, NetworkInfo, VolumeInfo } from '@models/docker';
import type { ResourceRef, ViewId } from '@models/nav';
import { withLinks } from '@utils/container-links';
import { withImageUsers } from '@utils/image-users';
import { describeRef, viewForRef } from '@utils/nav-history';
import { withNetworkUsers } from '@utils/network-users';
import { liveProjects, markOrphans } from '@utils/orphans';
import { markOutdated } from '@utils/outdated';
import { imagesToInspect, withProvenance } from '@utils/provenance';
import { groupIntoStacks, type Stack } from '@utils/stacks';
import { withUsers } from '@utils/volume-users';
import { isActive } from '@utils/status';
import { RefreshGate } from '@utils/refresh-gate';
import { TopBar } from '@ui/top-bar';
import { Footer } from '@ui/footer';
import { SideRail, RAIL_WIDTH } from '@ui/side-rail';
import type { RunMutation } from '@ui/widgets';
import { HelpOverlay } from '@ui/help-overlay';
import { Router } from '@ui/router';
import type { TabNav, ViewTab } from '@ui/view-tab';
import { StacksTab } from '@ui/stacks/stacks-tab';
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
  private readonly tabs: Record<ViewId, ViewTab>;
  private readonly router: Router;

  private overlayOpen = false;

  /** As the daemon lists them. */
  private listed: ContainerInfo[] = [];
  /** `listed`, joined with what the other listings say about each (a newer image) and each other. */
  private containers: ContainerInfo[] = [];
  private stacks: Stack[] = [];
  // Each null until its first fetch lands, so the tab keeps "Loading…" rather than flashing "No images".
  private images: ImageInfo[] | null = null;
  private volumes: VolumeInfo[] | null = null;
  private networks: NetworkInfo[] | null = null;
  /** The volumes and networks as last pushed: joined with their users, orphans marked. */
  private joinedVolumes: VolumeInfo[] = [];
  private joinedNetworks: NetworkInfo[] = [];
  /** No container listing yet: no project can be called empty. */
  private containersListed = false;
  /** Each inspected image's declared `VOLUME`s, by image ID: where anonymous volumes come from. */
  private readonly imageVolumes = new Map<string, string[]>();
  private aggregateStats: { cpuPercent: number; memUsageMB: number } | null = null;

  private pollTimers: NodeJS.Timeout[] = [];
  private footerMsgTimer: NodeJS.Timeout | null = null;
  private exitResolve: (() => void) | null = null;
  private pollingStats = false;
  /** Polling has stopped (shutting down): late results must not render into a destroyed screen. */
  private stopped = false;

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
    this.stacksTab = new StacksTab(this.screen, tabDims, onContainers, this.navFor('stacks'));
    this.containersTab = new ContainersTab(this.screen, tabDims, onContainers, this.navFor('containers'));
    this.imagesTab = new ImagesTab(
      this.screen,
      tabDims,
      this.mutationRunner(this.imagesGate),
      this.navFor('images'),
    );
    this.volumesTab = new VolumesTab(
      this.screen,
      tabDims,
      this.mutationRunner(this.volumesGate),
      this.navFor('volumes'),
    );
    this.networksTab = new NetworksTab(
      this.screen,
      tabDims,
      this.mutationRunner(this.networksGate),
      this.navFor('networks'),
    );
    this.tabs = {
      stacks: this.stacksTab,
      containers: this.containersTab,
      images: this.imagesTab,
      volumes: this.volumesTab,
      networks: this.networksTab,
    };
    this.router = new Router(
      this.tabs,
      {
        isInert: () => this.overlayOpen || this.router.activeTab().isInert(),
        onNavigated: (view) => {
          this.rail.setActiveView(view);
          this.syncFooter();
          this.render();
        },
        onMissing: (ref, reason) => this.reportMissing(ref, reason),
      },
      'stacks',
    );

    this.wireEvents();
    this.setupKeys();

    this.screen.on('destroy', () => this.stopPolling());
    this.screen.on('resize', () => this.handleResize());

    const externalShutdown = () => this.shutdown();
    process.once('SIGTERM', externalShutdown);
    process.once('SIGHUP', externalShutdown);
  }

  /** A tab's way to navigate: late-bound, because the router needs the tabs first. */
  private navFor(view: ViewId): TabNav {
    return {
      open: (panel) => this.router.open(view, panel),
      follow: (ref) => this.router.follow(ref),
    };
  }

  private wireEvents(): void {
    this.helpOverlay.on('hide', () => {
      this.overlayOpen = false;
      this.render();
    });

    this.rail.on('view-change', (id) => {
      if (!this.canSwitchView()) return;
      this.router.switchTo(id);
    });

    this.rail.on('stack-jump', (stackId) => {
      if (!this.canSwitchView()) return;
      if (!this.router.switchTo('stacks')) return;
      this.stacksTab.jumpToStack(stackId);
      this.render();
    });

    // Polls re-emit `context` every few seconds; only the active view's hints reach the footer, and
    // they come from the tab's own state, so an open panel or log viewer keeps its hints.
    for (const tab of Object.values(this.tabs)) {
      tab.on('context', () => {
        if (tab.view !== this.router.activeView()) return;
        this.syncFooter();
        this.render();
      });
      tab.on('error', (msg) => this.setFooterMessage(msg, 'red'));
      tab.on('info', (msg) => this.setFooterMessage(msg, 'green'));
    }
  }

  private syncFooter(): void {
    this.footer.setContext(this.router.activeTab().footerContext());
  }

  /** A link or a history step pointed at something that isn't there (yet). */
  private reportMissing(ref: ResourceRef, reason: 'gone' | 'unlisted'): void {
    if (reason === 'gone') {
      this.setFooterMessage(`${describeRef(ref)} no longer exists`, 'red');
      return;
    }
    this.setFooterMessage(`${describeRef(ref)} isn't listed yet — refreshing`, 'normal');
    void this.gateFor(viewForRef(ref)).poll();
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

  /** Opens help. Closing is the overlay's own job: it holds the keyboard while it is up. */
  private readonly openHelp = (): void => {
    if (this.overlayOpen || this.isHelpBlocked()) return;
    this.overlayOpen = true;
    this.helpOverlay.show();
  };

  private setupKeys(): void {
    // Inside a panel Tab moves between its sections: that's the panel's own key, so stay out.
    this.screen.key('tab', () => this.cycleView(1));
    this.screen.key('S-tab', () => this.cycleView(-1));

    for (let i = 0; i < VIEW_ORDER.length; i++) {
      const view = VIEW_ORDER[i];
      this.screen.key(String(i + 1), () => {
        if (!this.canSwitchView()) return;
        this.router.switchTo(view);
      });
    }

    // History works from panels too (that's how you get back from a followed link); the router
    // ignores it while help, a confirm or the filter is up.
    this.screen.key(['[', 'M-left'], () => this.router.back());
    this.screen.key([']', 'M-right'], () => this.router.forward());

    this.screen.key(['h'], this.openHelp);

    this.screen.key(['q', 'C-c'], () => {
      if (this.overlayOpen || this.isModalOpen()) return;
      this.shutdown();
    });
  }

  private cycleView(dir: 1 | -1): void {
    if (!this.canSwitchView()) return;
    const at = VIEW_ORDER.indexOf(this.router.activeView());
    this.router.switchTo(VIEW_ORDER[(at + dir + VIEW_ORDER.length) % VIEW_ORDER.length]);
  }

  private canSwitchView(): boolean {
    return !this.overlayOpen && !this.isModalOpen();
  }

  /** Only the active view can have anything open: hidden tabs close their panels. */
  private isModalOpen(): boolean {
    return this.router.activeTab().isOverlayOpen();
  }

  private isHelpBlocked(): boolean {
    return this.router.activeTab().isInert();
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

    for (const tab of Object.values(this.tabs)) tab.showLoading();

    this.router.start();
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

  /** The listing a view's rows come from. Stacks are grouped containers. */
  private gateFor(view: ViewId): RefreshGate {
    if (view === 'images') return this.imagesGate;
    if (view === 'volumes') return this.volumesGate;
    if (view === 'networks') return this.networksGate;
    return this.containersGate;
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
    this.listed = containers;
    this.containersListed = true;
    this.pushContainers();
    this.pushImages();
    this.pushVolumes();
    this.pushNetworks();
    this.refreshTopBarCounters();
    this.refreshRailCounts();
    this.footer.noteRefresh();
    this.render();
  }

  private async fetchImages(token: number): Promise<void> {
    try {
      const images = await listImages();
      if (!this.imagesGate.isCurrent(token)) return;
      this.images = images;
      // Which containers run an outdated image changes with either listing.
      this.pushContainers();
      this.pushImages();
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
      this.volumes = volumes;
      this.pushVolumes();
      this.afterResourceFetch();
    } catch (err) {
      if (!this.volumesGate.isCurrent(token)) return;
      this.setFooterMessage(msgOf(err), 'red');
    }
  }

  /** The containers joined with the other listings, to the views that list them. */
  private pushContainers(): void {
    this.containers = withLinks(markOutdated(this.listed, this.images ?? []));
    this.stacks = groupIntoStacks(this.containers);
    this.stacksTab.setData(this.containers, this.stacks);
    this.containersTab.setData(this.containers);
    this.rail.setStacks(this.stacks);
  }

  /**
   * Each resource listing joined with the containers using it. Re-run on either listing, so a
   * USED BY tracks the containers poll.
   */
  private pushImages(): void {
    if (this.images) this.imagesTab.setData(withImageUsers(this.images, this.containers));
  }

  private pushVolumes(): void {
    if (!this.volumes) return;
    const used = withUsers(this.volumes, this.containers);
    const traced = withProvenance(used, this.containers, this.imageVolumes, this.images ?? []);
    this.joinedVolumes = this.withOrphans(traced);
    this.volumesTab.setData(this.joinedVolumes);
    this.stacksTab.setResources(this.joinedVolumes, this.joinedNetworks);
    void this.inspectImages();
  }

  /**
   * Inspects the images anonymous volumes may have come from (once each: an image never changes),
   * then joins what they declare back in. A failed inspect is skipped and tried again next poll.
   */
  private async inspectImages(): Promise<void> {
    const missing = imagesToInspect(this.volumes ?? [], this.containers).filter(
      (id) => !this.imageVolumes.has(id),
    );
    if (missing.length === 0) return;
    const results = await Promise.allSettled(missing.map((id) => inspectImage(id)));
    if (this.stopped) return;
    let learned = false;
    results.forEach((r, i) => {
      if (r.status !== 'fulfilled' || this.imageVolumes.has(missing[i])) return;
      this.imageVolumes.set(missing[i], r.value.volumes);
      learned = true;
    });
    if (!learned) return;
    this.pushVolumes();
    this.render();
  }

  private pushNetworks(): void {
    if (!this.networks) return;
    this.joinedNetworks = this.withOrphans(withNetworkUsers(this.networks, this.containers));
    this.networksTab.setData(this.joinedNetworks);
    this.stacksTab.setResources(this.joinedVolumes, this.joinedNetworks);
  }

  /** Volumes or networks whose compose project has no containers left, marked as such. */
  private withOrphans<T extends VolumeInfo | NetworkInfo>(items: T[]): T[] {
    return this.containersListed ? markOrphans(items, liveProjects(this.stacks)) : items;
  }

  private async fetchNetworks(token: number): Promise<void> {
    try {
      const networks = await listNetworks();
      if (!this.networksGate.isCurrent(token)) return;
      this.networks = networks;
      this.pushNetworks();
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
      images: this.images?.length ?? 0,
      volumes: this.volumes?.length ?? 0,
      networks: this.networks?.length ?? 0,
    });
  }

  private handleResize(): void {
    for (const tab of Object.values(this.tabs)) tab.redraw();
    this.topBar.render();
    this.footer.render();
    this.render();
  }

  private stopPolling(): void {
    this.stopped = true;
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
