import { PassThrough } from 'stream';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type blessed from 'neo-blessed';
import type { ContainerInfo } from '@models/docker';
import type { PanelLoc } from '@models/nav';
import { groupIntoStacks } from '@utils/stacks';
import { ContainersTab } from '@ui/containers/containers-tab';
import { StacksTab } from '@ui/stacks/stacks-tab';
import type { TabNav, ViewTab } from '@ui/view-tab';
import { makeContainer } from '../fixtures';
import { KEY, makeScreen, press } from './headless';

// The log viewer streams from the daemon: hand it an empty stream instead.
vi.mock('@docker/containers', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  streamLogs: async () => new PassThrough(),
}));

/**
 * Widget tests, against the bar in CONTRIBUTING.md: in the log viewer ↵ meets the tab's own
 * screen-level ↵ in blessed's key routing (screen first, then the focused box).
 */

const DIMS = { top: 0, left: 0, width: '100%', height: '100%' };
const db = makeContainer({ id: 'c1', name: 'db', labels: { 'com.docker.compose.project': 'p' } });

describe.each([
  [
    'Containers',
    (s: blessed.Widgets.Screen, nav: TabNav) => new ContainersTab(s, DIMS, async (a) => a(), nav),
  ],
  ['Stacks', (s: blessed.Widgets.Screen, nav: TabNav) => new StacksTab(s, DIMS, async (a) => a(), nav)],
] as const)('%s: ↵ in the log viewer opens the container detail', (_name, make) => {
  let screen: blessed.Widgets.Screen;
  let tab: ViewTab & { setData(c: ContainerInfo[], ...rest: any[]): void };
  let opened: Array<PanelLoc | null>;

  beforeEach(() => {
    screen = makeScreen(100, 30);
    opened = [];
    // Stands in for App's router: record the request, then apply it the way the router does.
    const nav: TabNav = {
      open: (panel) => {
        opened.push(panel);
        tab.restore({ ...tab.location(), panel: panel ?? undefined });
      },
      follow: () => {},
    };
    tab = make(screen, nav) as typeof tab;
    tab.show();
    tab.setData([db], groupIntoStacks([db]));
    if (tab.view === 'stacks') press(screen, KEY.down); // from the stack's header to its service
  });

  afterEach(() => {
    screen.destroy();
  });

  it('as one step, so [ comes back to the logs', () => {
    press(screen, 'l');
    expect(tab.footerContext()).toBe('log');
    press(screen, KEY.enter);
    expect(opened).toEqual([
      { kind: 'logs', ref: { kind: 'container', id: 'c1', label: 'db' } },
      { kind: 'detail', ref: { kind: 'container', id: 'c1', label: 'db' } },
    ]);
    expect(tab.location().panel?.kind).toBe('detail');
  });
});
