import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type blessed from 'neo-blessed';
import type { PanelLoc, ResourceRef } from '@models/nav';
import { stripTags } from '@utils/format';
import { ImageDetail } from '@ui/images/image-detail';
import { ImagesTab } from '@ui/images/images-tab';
import type { TabNav } from '@ui/view-tab';
import { makeImage } from '../fixtures';
import { KEY, makeScreen, press } from './headless';

/**
 * Widget tests, against the bar in CONTRIBUTING.md: the list's screen-level ↵ and the open panel's
 * own ↵ meet in blessed's key routing (screen first, then the focused box), which no pure unit has.
 */

const DIMS = { top: 0, left: 0, width: '100%', height: '100%' };

const alpine = makeImage('sha256:294b683cb7240000', ['alpine:3', 'alpine:latest'], {
  inUse: true,
  users: [
    { id: 'c1', name: 'dzlink-api-1', status: 'running', exitCode: 0 },
    { id: 'c2', name: 'dzlink-side', status: 'exited', exitCode: 0 },
  ],
});
const dangling = makeImage('sha256:9223f452a3e30000', []);
const superseded = makeImage('sha256:9223f452a3e30000', ['dzlink/base:stable'], {
  inUse: true,
  users: [{ id: 'c3', name: 'dzlink-db-1', status: 'running', exitCode: 0 }],
  supersededBy: ['dzlink/base:1'],
});

/** Lets the copy promise chain (fire-and-forget inside the panel) finish. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
}

describe('Images: the detail panel over the list', () => {
  let screen: blessed.Widgets.Screen;
  let tab: ImagesTab;
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
    tab = new ImagesTab(screen, DIMS, async (action) => action(), nav);
    tab.on('error', (msg) => errors.push(msg));
    tab.show();
    tab.setData([alpine, dangling]);
  });

  afterEach(() => {
    screen.destroy();
  });

  it('↵ opens the selected image with one request, named by its first tag', () => {
    press(screen, KEY.enter);
    expect(opened).toEqual([
      { kind: 'detail', ref: { kind: 'image', id: 'sha256:294b683cb7240000', label: 'alpine:3' } },
    ]);
    expect(tab.footerContext()).toBe('image-detail');
    expect(tab.has({ kind: 'image', id: 'sha256:294b683cb7240000' })).toBe(true);
  });

  it('↵ on a USED BY row follows it once and does not re-open the panel', () => {
    press(screen, KEY.enter);
    press(screen, '\t');
    expect(tab.footerContext()).toContainEqual({ key: '↵', verb: 'open container' });
    press(screen, KEY.down);
    press(screen, KEY.enter);
    expect(followed).toEqual([{ kind: 'container', id: 'c2', label: 'dzlink-side' }]);
    expect(opened).toHaveLength(1);
  });

  it('d on an in-use image says why and keeps the panel open', () => {
    press(screen, KEY.enter);
    press(screen, 'd');
    expect(errors).toEqual(['Image in use — cannot delete']);
    expect(tab.isOverlayOpen()).toBe(true);
  });

  it('describes where it is, and comes back there', () => {
    press(screen, KEY.enter);
    press(screen, '\t');
    const here = tab.location();
    expect(here.panel?.focus).toEqual({ section: 'users', row: 'c1' });
    tab.restore({ view: 'images', selection: dangling.id });
    expect(tab.isOverlayOpen()).toBe(false);
    expect(tab.restore(here)).toBe(true);
    expect(tab.location()).toEqual(here);
  });

  it('a poll that drops the open image closes the panel without asking the router', () => {
    press(screen, KEY.enter);
    tab.setData([dangling]);
    expect(tab.isOverlayOpen()).toBe(false);
    expect(opened).toHaveLength(1);
  });
});

describe('ImageDetail content and copy', () => {
  let screen: blessed.Widgets.Screen;
  let detail: ImageDetail;
  let copies: string[];

  beforeEach(() => {
    screen = makeScreen(120, 30);
    copies = [];
    detail = new ImageDetail(screen, DIMS, async (text) => {
      copies.push(text);
      return { ok: true, method: 'native', tool: 'fake' };
    });
  });

  afterEach(() => {
    screen.destroy();
  });

  const text = (): string => stripTags((detail.box as any).content as string);

  it('shows every tag and who runs it', () => {
    detail.show(alpine);
    expect(text()).toContain('alpine:3  294b683cb724 · 100 MiB');
    expect(text()).toContain('● in use · 2 containers');
    expect(text()).toMatch(/TAGS \(2\)\n {3}alpine:3\n {3}alpine:latest/);
    expect(text()).toMatch(/● dzlink-api-1\s+running/);
    expect(text()).toMatch(/● dzlink-side\s+exited\(0\)/);
  });

  it('says when the tag its users follow has moved on to a newer image', () => {
    detail.show(superseded);
    expect(text()).toContain('↑ superseded by dzlink/base:1');
  });

  it('names a dangling image by its short ID', () => {
    detail.show(dangling);
    expect(text()).toContain('9223f452a3e3  9223f452a3e3');
    expect(text()).toContain('none — a dangling image');
    expect(text()).toContain('○ unused');
  });

  it('copies the image itself, or the selected user', async () => {
    detail.show(alpine);
    for (const key of ['n', 'i', 't', 'a']) {
      press(screen, 'y');
      press(screen, key);
    }
    press(screen, '\t');
    for (const key of ['n', 'i', 'a']) {
      press(screen, 'y');
      press(screen, key);
    }
    await settle();
    expect(copies).toEqual([
      'alpine:3',
      'sha256:294b683cb7240000',
      'alpine:3\nalpine:latest',
      'dzlink-api-1\ndzlink-side',
      'dzlink-api-1',
      'c1',
      'dzlink-api-1\ndzlink-side',
    ]);
  });
});
