import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type blessed from 'neo-blessed';
import type { PanelLoc, ResourceRef } from '@models/nav';
import { stripTags } from '@utils/format';
import { NetworkDetail } from '@ui/networks/network-detail';
import { NetworksTab } from '@ui/networks/networks-tab';
import type { TabNav } from '@ui/view-tab';
import { makeNetwork } from '../fixtures';
import { KEY, makeScreen, press } from './headless';

/**
 * Widget tests, against the bar in CONTRIBUTING.md: the list's screen-level ↵ and the open panel's
 * own ↵ meet in blessed's key routing (screen first, then the focused box), which no pure unit has.
 */

const DIMS = { top: 0, left: 0, width: '100%', height: '100%' };

const bridge = makeNetwork('bridge', {
  id: 'b8efd32ae545aaaa',
  builtin: true,
  subnets: ['172.17.0.0/16'],
  gateways: ['172.17.0.1'],
});
const back = makeNetwork('dzlink_back', {
  id: 'f1e53b0538dfaaaa',
  subnets: ['172.20.0.0/16'],
  gateways: ['172.20.0.1'],
  inUse: true,
  containerCount: 2,
  users: [
    {
      id: 'c1',
      name: 'dzlink-db-1',
      status: 'running',
      exitCode: 0,
      ip: '172.20.0.2',
      aliases: ['dzlink-db-1', 'db'],
    },
    {
      id: 'c2',
      name: 'dzlink-api-1',
      status: 'exited',
      exitCode: 0,
      ip: '',
      aliases: ['dzlink-api-1', 'api'],
    },
  ],
});
const host = makeNetwork('host', { driver: 'host', builtin: true });

/** Lets the copy promise chain (fire-and-forget inside the panel) finish. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
}

describe('Networks: the detail panel over the list', () => {
  let screen: blessed.Widgets.Screen;
  let tab: NetworksTab;
  let opened: Array<PanelLoc | null>;
  let followed: ResourceRef[];
  let errors: string[];

  beforeEach(() => {
    screen = makeScreen(120, 30);
    opened = [];
    followed = [];
    errors = [];
    // Stands in for App's router: record the request, then apply it the way the router does.
    const nav: TabNav = {
      open: (panel) => {
        opened.push(panel);
        tab.restore({ ...tab.location(), panel: panel ?? undefined });
      },
      follow: (ref) => followed.push(ref),
    };
    tab = new NetworksTab(screen, DIMS, async (action) => action(), nav);
    tab.on('error', (msg) => errors.push(msg));
    tab.show();
    tab.setData([bridge, back]);
  });

  afterEach(() => {
    screen.destroy();
  });

  it('↵ opens the selected network with one request, keyed by name', () => {
    press(screen, KEY.down);
    press(screen, KEY.enter);
    expect(opened).toEqual([{ kind: 'detail', ref: { kind: 'network', id: 'dzlink_back' } }]);
    expect(tab.footerContext()).toBe('network-detail');
    expect(tab.has({ kind: 'network', id: 'dzlink_back' })).toBe(true);
    expect(tab.has({ kind: 'network', id: 'f1e53b0538dfaaaa' })).toBe(false);
  });

  it('↵ on a USED BY row follows it once and does not re-open the panel', () => {
    press(screen, KEY.down);
    press(screen, KEY.enter);
    press(screen, '\t');
    press(screen, KEY.enter);
    expect(followed).toEqual([{ kind: 'container', id: 'c1', label: 'dzlink-db-1' }]);
    expect(opened).toHaveLength(1);
  });

  it('d keeps its guards: a built-in network says why and stays open', () => {
    press(screen, KEY.enter);
    press(screen, 'd');
    expect(errors).toEqual(['Built-in network — cannot delete']);
    expect(tab.isOverlayOpen()).toBe(true);
  });

  it('a poll that drops the open network closes the panel without asking the router', () => {
    press(screen, KEY.down);
    press(screen, KEY.enter);
    tab.setData([bridge]);
    expect(tab.isOverlayOpen()).toBe(false);
    expect(opened).toHaveLength(1);
  });
});

describe('NetworkDetail content and copy', () => {
  let screen: blessed.Widgets.Screen;
  let detail: NetworkDetail;
  let copies: string[];

  beforeEach(() => {
    screen = makeScreen(120, 30);
    copies = [];
    detail = new NetworkDetail(screen, DIMS, async (text) => {
      copies.push(text);
      return { ok: true, method: 'native', tool: 'fake' };
    });
  });

  afterEach(() => {
    screen.destroy();
  });

  const text = (): string => stripTags((detail.box as any).content as string);

  it('shows its addressing and who is attached, with their addresses and names', () => {
    detail.show(back);
    expect(text()).toContain('dzlink_back  bridge · local · f1e53b0538df');
    expect(text()).toContain('● in use · 2 containers');
    expect(text()).toContain('Subnet:    172.20.0.0/16');
    expect(text()).toContain('Gateway:   172.20.0.1');
    expect(text()).toMatch(/● dzlink-db-1\s+running\s+172\.20\.0\.2\s+dzlink-db-1, db/);
    expect(text()).toMatch(/● dzlink-api-1\s+exited\(0\)\s+—\s+dzlink-api-1, api/);
  });

  it('says what a built-in network without IPAM is', () => {
    detail.show(host);
    expect(text()).toContain('Subnet:    —');
    expect(text()).toContain("Built-in:  yes — Docker's own, can't be removed");
    expect(text()).toContain('[d] Remove (built-in)');
  });

  it('copies the network itself, or the selected user', async () => {
    detail.show(back);
    for (const key of ['n', 'i', 's', 'g', 'a']) {
      press(screen, 'y');
      press(screen, key);
    }
    press(screen, '\t');
    for (const key of ['n', 'i', 'p', 'd']) {
      press(screen, 'y');
      press(screen, key);
    }
    await settle();
    expect(copies).toEqual([
      'dzlink_back',
      'f1e53b0538dfaaaa',
      '172.20.0.0/16',
      '172.20.0.1',
      'dzlink-db-1\ndzlink-api-1',
      'dzlink-db-1',
      'c1',
      '172.20.0.2',
      'dzlink-db-1\ndb',
    ]);
  });

  it("disables a stopped user's address, saying why", () => {
    detail.show(back);
    press(screen, '\t');
    press(screen, KEY.down);
    press(screen, 'y');
    expect(stripTags((screen as any).children.map((c: any) => c.content ?? '').join('\n'))).toContain(
      'no address — the container is stopped',
    );
  });
});
