import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type blessed from 'neo-blessed';
import type { VolumeInfo } from '@models/docker';
import type { PanelLoc, ResourceRef } from '@models/nav';
import { stripTags } from '@utils/format';
import type { TabNav } from '@ui/view-tab';
import { VolumeDetail } from '@ui/volumes/volume-detail';
import { VolumesTab } from '@ui/volumes/volumes-tab';
import { KEY, makeScreen, press } from './headless';

/**
 * Widget tests, against the bar in CONTRIBUTING.md: the list's screen-level ↵ and the open panel's
 * own ↵ meet in blessed's key routing (screen first, then the focused box), which no pure unit has.
 */

const DIMS = { top: 0, left: 0, width: '100%', height: '100%' };

function volume(name: string, extra: Partial<VolumeInfo> = {}): VolumeInfo {
  return {
    name,
    driver: 'local',
    mountpoint: `/var/lib/docker/volumes/${name}/_data`,
    created: new Date(0),
    sizeMB: 0,
    labels: {},
    anonymous: false,
    users: [],
    inUse: false,
    ...extra,
  };
}

const pgdata = volume('db-pr02_pgdata', {
  stack: 'db-pr02',
  composeVolume: 'pgdata',
  sizeMB: 394,
  inUse: true,
  users: [
    {
      id: 'c1',
      name: 'db-pr02',
      status: 'exited',
      exitCode: 0,
      destination: '/var/lib/postgresql',
      rw: true,
    },
  ],
});
const orphan = volume('a'.repeat(64), { anonymous: true });

/** Lets the copy promise chain (fire-and-forget inside the panel) finish. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
}

describe('Volumes: the detail panel over the list', () => {
  let screen: blessed.Widgets.Screen;
  let tab: VolumesTab;
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
    tab = new VolumesTab(screen, DIMS, async (action) => action(), nav);
    tab.on('error', (msg) => errors.push(msg));
    tab.show();
    tab.setData([orphan, pgdata]);
  });

  afterEach(() => {
    screen.destroy();
  });

  it('↵ opens the selected volume with one request', () => {
    press(screen, KEY.down);
    press(screen, KEY.enter);
    expect(opened).toEqual([{ kind: 'detail', ref: { kind: 'volume', id: 'db-pr02_pgdata' } }]);
    expect(tab.isOverlayOpen()).toBe(true);
    expect(tab.footerContext()).toBe('volume-detail');
    expect(tab.has({ kind: 'volume', id: 'db-pr02_pgdata' })).toBe(true);
    expect(tab.has({ kind: 'container', id: 'db-pr02_pgdata' })).toBe(false);
  });

  it('↵ on a USED BY row follows it once and does not re-open the panel', () => {
    press(screen, KEY.down);
    press(screen, KEY.enter);
    press(screen, '\t');
    expect(tab.footerContext()).toBe('volume-detail-users');
    press(screen, KEY.enter);
    expect(followed).toEqual([{ kind: 'container', id: 'c1', label: 'db-pr02' }]);
    expect(opened).toHaveLength(1);
  });

  it('d on an in-use volume says why and keeps the panel open', () => {
    press(screen, KEY.down);
    press(screen, KEY.enter);
    press(screen, 'd');
    expect(errors).toEqual(['Volume in use — cannot delete']);
    expect(tab.isOverlayOpen()).toBe(true);
    expect(tab.isInert()).toBe(false);
  });

  it('d on an unused volume closes the panel (a history step), then asks', () => {
    press(screen, KEY.enter); // the orphan
    press(screen, 'd');
    expect(opened).toEqual([expect.objectContaining({ kind: 'detail' }), null]);
    expect(tab.isInert()).toBe(true); // the confirm dialog
  });

  it('describes where it is, and comes back there', () => {
    press(screen, KEY.down);
    press(screen, KEY.enter);
    press(screen, '\t');
    const here = tab.location();
    expect(here).toEqual({
      view: 'volumes',
      selection: 'db-pr02_pgdata',
      panel: {
        kind: 'detail',
        ref: { kind: 'volume', id: 'db-pr02_pgdata' },
        focus: { section: 'users', row: 'c1:/var/lib/postgresql' },
      },
    });
    tab.restore({ view: 'volumes', selection: orphan.name });
    expect(tab.isOverlayOpen()).toBe(false);
    expect(tab.restore(here)).toBe(true);
    expect(tab.location()).toEqual(here);
  });

  it('a poll that drops the open volume closes the panel without asking the router', () => {
    press(screen, KEY.enter);
    tab.setData([pgdata]);
    expect(tab.isOverlayOpen()).toBe(false);
    expect(opened).toHaveLength(1);
  });
});

describe('VolumeDetail content and copy', () => {
  let screen: blessed.Widgets.Screen;
  let detail: VolumeDetail;
  let copies: string[];

  beforeEach(() => {
    screen = makeScreen(120, 30);
    copies = [];
    detail = new VolumeDetail(screen, DIMS, async (text) => {
      copies.push(text);
      return { ok: true, method: 'native', tool: 'fake' };
    });
  });

  afterEach(() => {
    screen.destroy();
  });

  const text = (): string => stripTags((detail.box as any).content as string);

  it('shows where it came from and who uses it', () => {
    detail.show(pgdata);
    expect(text()).toContain('Origin:      compose project db-pr02 · volume pgdata');
    expect(text()).toContain('● in use · 1 container');
    expect(text()).toContain('USED BY (1)');
    expect(text()).toMatch(/● db-pr02\s+exited\(0\)\s+→ \/var\/lib\/postgresql\s+rw/);
  });

  it('is honest about an unused volume: no record of past users', () => {
    detail.show(orphan);
    expect(text()).toContain('Origin:      anonymous');
    expect(text()).toContain('USED BY (0)  none — Docker keeps no record of containers that used it before');
    expect(text()).toContain('○ unused');
  });

  it('copies the volume itself, or the selected user', async () => {
    detail.show(pgdata);
    for (const key of ['n', 'p', 'a']) {
      press(screen, 'y');
      press(screen, key);
    }
    press(screen, '\t');
    for (const key of ['n', 'i', 'd', 'y']) {
      press(screen, 'y');
      press(screen, key);
    }
    await settle();
    expect(copies).toEqual([
      'db-pr02_pgdata',
      '/var/lib/docker/volumes/db-pr02_pgdata/_data',
      'db-pr02',
      'db-pr02',
      'c1',
      '/var/lib/postgresql',
      'db-pr02_pgdata:/var/lib/postgresql',
    ]);
  });
});
