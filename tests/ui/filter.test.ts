import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type blessed from 'neo-blessed';
import type { ContainerInfo } from '@models/docker';
import type { PanelLoc } from '@models/nav';
import { ContainersTab } from '@ui/containers/containers-tab';
import { ResourceListTab, type ResourceListConfig } from '@ui/resource-list-tab';
import { StacksTab } from '@ui/stacks/stacks-tab';
import type { TabNav } from '@ui/view-tab';
import { groupIntoStacks } from '@utils/stacks';
import { makeContainer } from '../fixtures';
import { KEY, makeScreen, press } from './headless';

/**
 * Widget tests, against the bar in CONTRIBUTING.md: while the filter is typed it holds the keyboard
 * (`grabKeys`), so what's under test only exists in blessed's real key routing — a view's `d` or `q`
 * landing in the query instead, and the arrow keys still reaching the list.
 */

const DIMS = { top: 0, left: 0, width: '100%', height: '100%' };
const BACKSPACE = '\x7f';
const CTRL_U = '\x15';
const CTRL_W = '\x17';

/** Drains the promise chains behind the confirm dialog's fire-and-forget `void` call. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r));
}

function rowsOf(list: blessed.Widgets.ListElement): string[] {
  return (list as any).items.map((i: any) => String(i.getText()).trim());
}

/** What the bottom border shows: the query box, then the count. */
function barOf(tab: object): string {
  const bar = (tab as any).filterBar;
  const text = (box: blessed.Widgets.BoxElement) => (box.hidden ? '' : box.getText().trim());
  return [text(bar.queryBox), text(bar.countBox)].filter(Boolean).join(' | ');
}

interface Item {
  id: string;
  name: string;
}

const ITEMS: Item[] = ['alpha', 'beta', 'delta', 'gamma'].map((name) => ({ id: name[0], name }));

describe('filter on a resource list', () => {
  let screen: blessed.Widgets.Screen;
  let tab: ResourceListTab<Item>;
  let removed: string[];

  beforeEach(() => {
    screen = makeScreen();
    removed = [];
    const config: ResourceListConfig<Item> = {
      view: 'images',
      footer: 'images',
      remove: async (item) => {
        removed.push(item.id);
      },
      getKey: (item) => item.id,
      emptyMessage: 'No items',
      confirmTitle: 'Remove item?',
      confirmLabel: (item) => item.name,
      guards: [],
      columns: [{ header: 'NAME', weight: 0, render: (item) => item.name }],
      filterFields: (item) => [item.name],
    };
    tab = new ResourceListTab<Item>(screen, DIMS, config, async (action) => action(), {
      open: () => {},
      follow: () => {},
    });
    tab.show();
    tab.setData(ITEMS);
  });

  afterEach(() => {
    screen.destroy();
  });

  const rows = () => rowsOf(tab.list);
  const type = (s: string) => [...s].forEach((ch) => press(screen, ch));

  it('narrows with every key typed, ignoring case', () => {
    press(screen, '/');
    expect(tab.isInert()).toBe(true);
    expect(tab.footerContext()).toBe('filter');
    expect(rows()).toEqual(['alpha', 'beta', 'delta', 'gamma']);

    press(screen, 'E');
    expect(rows()).toEqual(['beta', 'delta']);
    press(screen, 'L');
    expect(rows()).toEqual(['delta']);
    expect(barOf(tab)).toBe('/ EL | 1 of 4');
  });

  it("holds the keyboard while typing: a view's keys land in the query", async () => {
    const quit = vi.fn();
    screen.key(['q', 'h'], quit);

    press(screen, '/');
    type('dqhy');
    await settle();

    expect(removed).toEqual([]);
    expect(quit).not.toHaveBeenCalled();
    expect(tab.isOverlayOpen()).toBe(true);
    expect(rows()).toEqual([]);
    expect(barOf(tab)).toBe('/ dqhy | 0 of 4');
  });

  it('↓ walks the matches while typing; Enter keeps the filter for the list keys', async () => {
    press(screen, '/');
    press(screen, 'e');
    // alpha was selected and no longer matches: the cursor goes to the first match.
    expect(tab.location().selection).toBe('b');

    press(screen, KEY.down);
    expect(tab.location().selection).toBe('d');

    press(screen, KEY.enter);
    expect(tab.isInert()).toBe(false);
    expect(screen.grabKeys).toBe(false);
    expect(rows()).toEqual(['beta', 'delta']);
    expect(tab.footerContext()).toEqual(expect.arrayContaining([{ key: 'Esc', verb: 'unfilter' }]));

    press(screen, 'd');
    press(screen, 'y');
    await settle();
    expect(removed).toEqual(['d']);
  });

  it('keeps the selected row while it still matches', () => {
    tab.list.select(2); // delta
    press(screen, '/');
    press(screen, 'e');
    expect(tab.location().selection).toBe('d');
  });

  it('Esc while typing clears the filter', () => {
    press(screen, '/');
    press(screen, 'e');
    press(screen, KEY.escape);
    expect(rows()).toEqual(['alpha', 'beta', 'delta', 'gamma']);
    expect(tab.isInert()).toBe(false);
    expect(screen.grabKeys).toBe(false);
    expect(barOf(tab)).toBe('');
  });

  it('Esc on the list clears a kept filter; `/` reopens it with the query', () => {
    press(screen, '/');
    press(screen, 'e');
    press(screen, KEY.enter);
    expect(barOf(tab)).toBe('/ e | 2 of 4');

    press(screen, '/');
    press(screen, 'l');
    expect(rows()).toEqual(['delta']);
    press(screen, KEY.enter);

    press(screen, KEY.escape);
    expect(rows()).toEqual(['alpha', 'beta', 'delta', 'gamma']);
    expect(tab.footerContext()).toBe('images');
  });

  it('Backspace, Ctrl+W and Ctrl+U edit the query', () => {
    press(screen, '/');
    type('el');
    expect(rows()).toEqual(['delta']);
    press(screen, BACKSPACE);
    expect(rows()).toEqual(['beta', 'delta']);
    type(' x');
    press(screen, CTRL_W);
    expect(barOf(tab)).toBe('/ e | 2 of 4');
    press(screen, CTRL_U);
    expect(rows()).toEqual(['alpha', 'beta', 'delta', 'gamma']);
    expect(tab.isInert()).toBe(true);
  });

  it('a poll keeps the filter applied and the cursor on its row', () => {
    press(screen, '/');
    press(screen, 'e');
    press(screen, KEY.down);
    press(screen, KEY.enter);

    tab.setData([...ITEMS, { id: 'e', name: 'epsilon' }]);
    expect(rows()).toEqual(['beta', 'delta', 'epsilon']);
    expect(tab.location().selection).toBe('d');
    expect(barOf(tab)).toBe('/ e | 3 of 5');
  });

  it('history landing on a row the filter hides clears the filter', () => {
    press(screen, '/');
    press(screen, 'e');
    press(screen, KEY.enter);

    tab.restore({ view: 'images', selection: 'g' });
    expect(rows()).toEqual(['alpha', 'beta', 'delta', 'gamma']);
    expect(tab.location().selection).toBe('g');
  });

  it('says what did not match', () => {
    press(screen, '/');
    type('{zz}');
    const message = (tab as any).messageBox.getText().trim();
    expect(message).toBe('No matches for {zz}');
  });

  it('focus moving away (a click) keeps the query and frees the keyboard', () => {
    press(screen, '/');
    press(screen, 'e');
    tab.list.focus();
    expect(tab.isInert()).toBe(false);
    expect(screen.grabKeys).toBe(false);
    expect(rows()).toEqual(['beta', 'delta']);
  });

  it('hiding the view while typing frees the keyboard', () => {
    press(screen, '/');
    tab.hide();
    expect(screen.grabKeys).toBe(false);
    expect(tab.isInert()).toBe(false);
  });
});

describe('filter on the containers list', () => {
  let screen: blessed.Widgets.Screen;
  let tab: ContainersTab;
  let opened: Array<PanelLoc | null>;

  beforeEach(() => {
    screen = makeScreen();
    opened = [];
    const nav: TabNav = {
      open: (panel) => {
        opened.push(panel);
        tab.restore({ ...tab.location(), panel: panel ?? undefined });
      },
      follow: () => {},
    };
    tab = new ContainersTab(screen, DIMS, async (action) => action(), nav);
    tab.show();
    tab.setData([
      makeContainer({ id: 'c1', name: 'cache', image: 'redis:7' }),
      makeContainer({ id: 'c2', name: 'proxy', image: 'nginx:1.27' }),
      makeContainer({ id: 'c3', name: 'web', image: 'nginx:1.27' }),
    ]);
  });

  afterEach(() => {
    screen.destroy();
  });

  const rows = () => rowsOf((tab as any).containerList.list).map((r) => r.split(/\s+/)[1]);

  it('filters by image; the list keys then act on the match under the cursor', () => {
    press(screen, '/');
    for (const ch of 'NGINX') press(screen, ch);
    expect(rows()).toEqual(['proxy', 'web']);

    press(screen, KEY.down);
    press(screen, KEY.enter);
    press(screen, 'l');
    expect(opened).toEqual([{ kind: 'logs', ref: { kind: 'container', id: 'c3', label: 'web' } }]);
  });

  it('↵ after the filter opens the detail of the selected match', () => {
    press(screen, '/');
    press(screen, 'x'); // matches proxy only
    press(screen, KEY.enter);
    press(screen, KEY.enter);
    expect(opened).toEqual([{ kind: 'detail', ref: { kind: 'container', id: 'c2', label: 'proxy' } }]);
  });

  it('a stats refresh keeps the filter', () => {
    press(screen, '/');
    press(screen, 'w');
    press(screen, KEY.enter);
    tab.refreshListStats();
    expect(rows()).toEqual(['web']);
  });
});

describe('filter on the stacks tree', () => {
  let screen: blessed.Widgets.Screen;
  let tab: StacksTab;
  let opened: Array<PanelLoc | null>;

  const service = (project: string, name: string, image: string): ContainerInfo =>
    makeContainer({
      id: `${project}-${name}`,
      name: `${project}-${name}-1`,
      image,
      labels: { 'com.docker.compose.project': project },
      compose: { project, service: name, configFiles: [], dependsOn: [], oneoff: false },
    });

  const containers = [
    service('shop', 'web', 'nginx'),
    service('shop', 'db', 'postgres'),
    service('blog', 'app', 'ghost'),
    service('blog', 'db', 'mysql'),
  ];

  beforeEach(() => {
    screen = makeScreen();
    opened = [];
    const nav: TabNav = {
      open: (panel) => {
        opened.push(panel);
        tab.restore({ ...tab.location(), panel: panel ?? undefined });
      },
      follow: () => {},
    };
    tab = new StacksTab(screen, DIMS, async (action) => action(), nav);
    tab.show();
    tab.setData(containers, groupIntoStacks(containers));
  });

  afterEach(() => {
    screen.destroy();
  });

  const rows = () =>
    rowsOf((tab as any).tree.list).map((r) => r.replace(/^[▾▸├└─▣●○◐\s]+/, '').split(/\s+/)[0]);

  it('a service match shows its stack with only the matching services, as you type', () => {
    expect(rows()).toEqual(['shop', 'shop-db-1', 'shop-web-1', 'blog', 'blog-app-1', 'blog-db-1']);

    press(screen, '/');
    press(screen, 'D');
    expect(rows()).toEqual(['shop', 'shop-db-1', 'blog', 'blog-db-1']);
    press(screen, 'B');
    expect(rows()).toEqual(['shop', 'shop-db-1', 'blog', 'blog-db-1']);
    press(screen, BACKSPACE);
    press(screen, BACKSPACE);
    for (const ch of 'ghost') press(screen, ch);
    expect(rows()).toEqual(['blog', 'blog-app-1']);
    expect(barOf(tab)).toBe('/ ghost | 1 of 4');
  });

  it('a stack-name match shows the whole stack', () => {
    press(screen, '/');
    for (const ch of 'SHOP') press(screen, ch);
    expect(rows()).toEqual(['shop', 'shop-db-1', 'shop-web-1']);
  });

  it('Enter keeps the filter; ↵ then opens the service under the cursor', () => {
    press(screen, '/');
    for (const ch of 'mysql') press(screen, ch);
    press(screen, KEY.down);
    press(screen, KEY.enter);
    expect(tab.isInert()).toBe(false);

    press(screen, KEY.enter);
    expect(opened).toEqual([
      { kind: 'detail', ref: { kind: 'container', id: 'blog-db', label: 'blog-db-1' } },
    ]);
  });

  it('Esc restores the whole tree', () => {
    press(screen, '/');
    press(screen, 'z');
    expect(rows()).toEqual([]);
    press(screen, KEY.escape);
    expect(rows()).toEqual(['shop', 'shop-db-1', 'shop-web-1', 'blog', 'blog-app-1', 'blog-db-1']);
  });

  it('jumping to a stack the filter hides clears the filter', () => {
    press(screen, '/');
    for (const ch of 'shop') press(screen, ch);
    press(screen, KEY.enter);

    tab.jumpToStack('blog');
    expect(rows()).toContain('blog');
    expect(tab.location().selection).toBe('s:blog');
  });
});
