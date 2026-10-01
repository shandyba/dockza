import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type blessed from 'neo-blessed';
import type { ContainerInfo } from '@models/docker';
import type { PanelLoc, ResourceRef } from '@models/nav';
import { stripTags } from '@utils/format';
import { groupIntoStacks } from '@utils/stacks';
import { StackDetail } from '@ui/stacks/stack-detail';
import { StacksTab } from '@ui/stacks/stacks-tab';
import type { TabNav } from '@ui/view-tab';
import { endpoint, makeContainer, makeNetwork, makeVolume } from '../fixtures';
import { KEY, makeScreen, press } from './headless';

/**
 * Widget tests, against the bar in CONTRIBUTING.md: the tree's screen-level ↵ and the open panel's
 * own ↵ meet in blessed's key routing (screen first, then the focused box), which no pure unit has.
 */

const DIMS = { top: 0, left: 0, width: '100%', height: '100%' };

const compose = (service: string, dependsOn: string[] = []) => ({
  project: 'dzlink',
  service,
  configFiles: ['/srv/dzlink/compose.yaml'],
  workingDir: '/srv/dzlink',
  dependsOn,
  oneoff: false,
});
const labels = { 'com.docker.compose.project': 'dzlink' };

const db = makeContainer({ id: 'c-db', name: 'dzlink-db-1', labels, compose: compose('db') });
const api = makeContainer({
  id: 'c-api',
  name: 'dzlink-api-1',
  status: 'exited',
  labels,
  compose: compose('api', ['db']),
});
const loner = makeContainer({ id: 'c-x', name: 'loner', networks: [endpoint('bridge')] });

const data = makeVolume('dzlink_data', { stack: 'dzlink', composeVolume: 'data', inUse: true });
const other = makeVolume('other_data', { stack: 'other' });
const back = makeNetwork('dzlink_back', {
  stack: 'dzlink',
  composeNetwork: 'back',
  subnets: ['172.20.0.0/16'],
});

function load(tab: StacksTab, containers: ContainerInfo[]): void {
  tab.setData(containers, groupIntoStacks(containers));
}

/** Lets the copy promise chain (fire-and-forget inside the panel) finish. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
}

describe('Stacks: the stack detail over the tree', () => {
  let screen: blessed.Widgets.Screen;
  let tab: StacksTab;
  let opened: Array<PanelLoc | null>;
  let followed: ResourceRef[];

  beforeEach(() => {
    screen = makeScreen(120, 30);
    opened = [];
    followed = [];
    // Stands in for App's router: record the request, then apply it the way the router does.
    const nav: TabNav = {
      open: (panel) => {
        opened.push(panel);
        tab.restore({ ...tab.location(), panel: panel ?? undefined });
      },
      follow: (ref) => followed.push(ref),
    };
    tab = new StacksTab(screen, DIMS, async (action) => action(), nav);
    tab.show();
    load(tab, [db, api, loner]);
    tab.setResources([data, other], [back]);
  });

  afterEach(() => {
    screen.destroy();
  });

  it('↵ on a stack header opens its detail with one request', () => {
    expect(tab.location().selection).toBe('s:dzlink');
    press(screen, KEY.enter);
    expect(opened).toEqual([{ kind: 'detail', ref: { kind: 'stack', id: 'dzlink' } }]);
    expect(tab.isOverlayOpen()).toBe(true);
    expect(tab.footerContext()).toBe('stack-detail');
    expect(tab.has({ kind: 'stack', id: 'dzlink' })).toBe(true);
    expect(tab.has({ kind: 'stack', id: 'gone' })).toBe(false);
  });

  it('→ and ← still collapse and expand a stack; ↵ on a service still opens the container', () => {
    press(screen, KEY.left); // collapse dzlink
    press(screen, KEY.down); // the next stack's header
    expect(tab.location().selection).toBe('s:(no stack)');
    press(screen, KEY.up);
    press(screen, KEY.right); // expand again
    press(screen, KEY.down);
    press(screen, KEY.enter);
    expect(opened).toEqual([
      { kind: 'detail', ref: { kind: 'container', id: 'c-db', label: 'dzlink-db-1' } },
    ]);
  });

  it('↵ on a SERVICES row follows it once and does not re-open the panel', () => {
    press(screen, KEY.enter);
    press(screen, '\t');
    expect(tab.footerContext()).toContainEqual({ key: '↵', verb: 'open container' });
    press(screen, KEY.enter);
    expect(followed).toEqual([{ kind: 'container', id: 'c-db', label: 'dzlink-db-1' }]);
    expect(opened).toHaveLength(1);
  });

  it('Tab walks SERVICES → VOLUMES → NETWORKS; ↵ opens a volume and a network', () => {
    press(screen, KEY.enter);
    press(screen, '\t');
    press(screen, '\t');
    press(screen, KEY.enter);
    press(screen, '\t');
    press(screen, KEY.enter);
    expect(followed).toEqual([
      { kind: 'volume', id: 'dzlink_data' },
      { kind: 'network', id: 'dzlink_back' },
    ]);
  });

  it('describes where it is, and comes back there', () => {
    press(screen, KEY.enter);
    press(screen, '\t');
    press(screen, KEY.down);
    const here = tab.location();
    expect(here).toEqual({
      view: 'stacks',
      selection: 's:dzlink',
      panel: {
        kind: 'detail',
        ref: { kind: 'stack', id: 'dzlink' },
        focus: { section: 'services', row: 'c-api' },
      },
    });
    tab.restore({ view: 'stacks', selection: 's:dzlink' });
    expect(tab.isOverlayOpen()).toBe(false);
    expect(tab.restore(here)).toBe(true);
    expect(tab.location()).toEqual(here);
  });

  it('container actions do nothing over a stack detail', () => {
    press(screen, KEY.enter);
    press(screen, 'd');
    press(screen, 'l');
    expect(tab.isInert()).toBe(false); // no confirm
    expect(opened).toHaveLength(1); // no logs
  });

  it('a poll that drops the stack closes the panel without asking the router', () => {
    press(screen, KEY.enter);
    load(tab, [loner]);
    expect(tab.isOverlayOpen()).toBe(false);
    expect(opened).toHaveLength(1);
  });

  it('restoring a stack that has gone returns false and leaves the tree showing', () => {
    const ok = tab.restore({ view: 'stacks', panel: { kind: 'detail', ref: { kind: 'stack', id: 'gone' } } });
    expect(ok).toBe(false);
    expect(tab.isOverlayOpen()).toBe(false);
  });
});

describe('StackDetail content and copy', () => {
  let screen: blessed.Widgets.Screen;
  let detail: StackDetail;
  let copies: string[];

  beforeEach(() => {
    screen = makeScreen(120, 30);
    copies = [];
    detail = new StackDetail(screen, DIMS, async (text) => {
      copies.push(text);
      return { ok: true, method: 'native', tool: 'fake' };
    });
  });

  afterEach(() => {
    screen.destroy();
  });

  const text = (): string => stripTags((detail.box as any).content as string);
  const [stack] = groupIntoStacks([db, api]);

  it('shows the project, its counts, files, services and its own volumes and networks', () => {
    detail.show(stack, { volumes: [data, other], networks: [back] });
    expect(text()).toContain('dzlink  compose project');
    expect(text()).toContain('● live  1 running · 0 errored · 1 stopped');
    expect(text()).toContain('File:  /srv/dzlink/compose.yaml');
    expect(text()).toContain('Dir:   /srv/dzlink');
    expect(text()).toMatch(/● dzlink-db-1\s+db\s+running\s+img/);
    expect(text()).toMatch(/VOLUMES \(1\)\s+Tab select\n\s+dzlink_data\s+data\s+● in use/);
    expect(text()).toMatch(/NETWORKS \(1\)\s+Tab select\n\s+dzlink_back\s+back\s+172\.20\.0\.0\/16/);
  });

  it('a stack picked out by its default network: no compose files to show', () => {
    const [legacy] = groupIntoStacks([makeContainer({ networks: [endpoint('legacy_default')] })]);
    detail.show(legacy, { volumes: [], networks: [makeNetwork('legacy_default')] });
    expect(text()).toContain('legacy  grouped by its legacy_default network');
    expect(text()).toContain('File:  —');
    expect(text()).toMatch(/NETWORKS \(1\)\s+Tab select\n\s+legacy_default/);
  });

  it('a container labelled with just a project is still a compose project', () => {
    const labelled = makeContainer({
      labels: { 'com.docker.compose.project': 'bare' },
      compose: { project: 'bare', service: '', configFiles: [], dependsOn: [], oneoff: false },
    });
    detail.show(groupIntoStacks([labelled])[0], { volumes: [], networks: [] });
    expect(text()).toContain('bare  compose project');
  });

  it('copies the project itself, or the selected row', async () => {
    detail.show(stack, { volumes: [data], networks: [back] });
    for (const key of ['n', 'f', 'w', 'a']) {
      press(screen, 'y');
      press(screen, key);
    }
    press(screen, '\t');
    for (const key of ['n', 'i', 'm']) {
      press(screen, 'y');
      press(screen, key);
    }
    await settle();
    expect(copies).toEqual([
      'dzlink',
      '/srv/dzlink/compose.yaml',
      '/srv/dzlink',
      'db\napi',
      'dzlink-db-1',
      'c-db',
      'img',
    ]);
  });
});
