import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type blessed from 'neo-blessed';
import type { ContainerInfo } from '@models/docker';
import type { PanelLoc } from '@models/nav';
import { ContainersTab } from '@ui/containers/containers-tab';
import { LogViewer } from '@ui/containers/log-viewer';
import { ConfirmDialog } from '@ui/containers/confirm-dialog';
import type { TabNav } from '@ui/view-tab';
import { makeContainer } from '../fixtures';
import { KEY, makeScreen, press } from './headless';

/**
 * Widget tests, against the bar in CONTRIBUTING.md: what's under test only exists against blessed's
 * real key routing — a listener-removal quirk, and screen keys firing before the focused panel's.
 */

const DIMS = { top: 0, left: 0, width: '100%', height: '100%' };

function container(id: string, extra: Partial<ContainerInfo> = {}): ContainerInfo {
  return makeContainer({ id, name: `name-${id}`, ...extra });
}

describe('hide() is safe to call on a hidden widget', () => {
  let screen: blessed.Widgets.Screen;

  beforeEach(() => {
    screen = makeScreen();
  });

  afterEach(() => {
    screen.destroy();
  });

  // blessed's removeListener deletes a key's only listener whatever handler it's given.
  it("a stray LogViewer.hide() leaves another widget's k alone", () => {
    const kill = vi.fn();
    screen.key(['k'], kill);
    new LogViewer(screen, DIMS).hide();
    press(screen, 'k');
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it("a stray ConfirmDialog.hide() leaves another widget's Esc alone", () => {
    const close = vi.fn();
    screen.key(['escape'], close);
    new ConfirmDialog(screen).hide();
    press(screen, KEY.escape);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('ContainersTab asks the router, once per key', () => {
  let screen: blessed.Widgets.Screen;
  let tab: ContainersTab;
  let opened: Array<PanelLoc | null>;

  beforeEach(() => {
    screen = makeScreen();
    opened = [];
    // Stands in for App's router: record the request, then apply it the way the router does.
    const nav: TabNav = {
      open: (panel) => {
        opened.push(panel);
        tab.restore({ ...tab.location(), panel: panel ?? undefined });
      },
      follow: () => {},
    };
    tab = new ContainersTab(screen, DIMS, async (action) => action(), nav);
    tab.show();
    tab.setData([container('c1'), container('c2')]);
  });

  afterEach(() => {
    screen.destroy();
  });

  it('↵ opens the detail with one request, and Esc closes it with one', () => {
    press(screen, KEY.enter); // blessed sends `enter`, then `return`
    expect(opened).toEqual([{ kind: 'detail', ref: { kind: 'container', id: 'c1', label: 'name-c1' } }]);
    expect(tab.isOverlayOpen()).toBe(true);
    expect(tab.footerContext()).toBe('detail');

    press(screen, KEY.escape);
    expect(opened).toHaveLength(2);
    expect(opened[1]).toBeNull();
    expect(tab.isOverlayOpen()).toBe(false);
  });

  it('describes where it is: row, panel and focus', () => {
    press(screen, KEY.down);
    press(screen, KEY.enter);
    expect(tab.location()).toEqual({
      view: 'containers',
      selection: 'c2',
      panel: { kind: 'detail', ref: { kind: 'container', id: 'c2', label: 'name-c2' } },
    });
  });

  it('restoring a container that has gone returns false and leaves the list showing', () => {
    const ok = tab.restore({
      view: 'containers',
      panel: { kind: 'detail', ref: { kind: 'container', id: 'gone' } },
    });
    expect(ok).toBe(false);
    expect(tab.isOverlayOpen()).toBe(false);
  });

  it('a poll that removes the open container closes the panel without asking the router', () => {
    press(screen, KEY.enter);
    tab.setData([container('c2')]);
    expect(tab.isOverlayOpen()).toBe(false);
    expect(opened).toHaveLength(1);
  });

  it('show() and hide() are idempotent: keys stay bound once', () => {
    tab.show(); // already shown
    press(screen, KEY.enter);
    expect(opened).toHaveLength(1);
    tab.hide();
    tab.hide();
    press(screen, KEY.enter);
    expect(opened).toHaveLength(1);
  });
});
