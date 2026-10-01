import { describe, it, expect, beforeEach } from 'vitest';
import type { Location, PanelLoc, ResourceRef, ViewId } from '@models/nav';
import { Router, type RouterHost } from '@ui/router';
import type { ViewTab } from '@ui/view-tab';

/**
 * A tab reduced to the state the router reads and writes: a selected row and an open panel.
 * `log` records the calls the router made, in order.
 */
class FakeTab implements ViewTab {
  selection: string | undefined;
  panel: PanelLoc | undefined;
  rows: string[] = [];
  log: string[] = [];

  constructor(readonly view: ViewId) {}

  show(): void {
    this.log.push('show');
  }
  hide(): void {
    this.log.push('hide');
    this.panel = undefined;
  }
  showLoading(): void {}
  redraw(): void {}
  location(): Location {
    return {
      view: this.view,
      ...(this.selection ? { selection: this.selection } : {}),
      ...(this.panel ? { panel: this.panel } : {}),
    };
  }
  restore(loc: Location): boolean {
    this.log.push(`restore:${loc.panel ? `${loc.panel.kind}:${loc.panel.ref.id}` : (loc.selection ?? '-')}`);
    const id = loc.panel?.ref.id ?? loc.selection;
    if (id && this.rows.includes(id)) this.selection = id;
    if (loc.panel && !this.rows.includes(loc.panel.ref.id)) {
      this.panel = undefined;
      return false;
    }
    this.panel = loc.panel;
    return true;
  }
  has(ref: ResourceRef): boolean {
    return this.rows.includes(ref.id);
  }
  footerContext() {
    return 'global' as const;
  }
  isOverlayOpen(): boolean {
    return this.panel !== undefined;
  }
  isInert(): boolean {
    return false;
  }
  on(): void {}
}

const vol = (id: string): ResourceRef => ({ kind: 'volume', id });
const ctr = (id: string): ResourceRef => ({ kind: 'container', id });

describe('Router', () => {
  let tabs: Record<ViewId, FakeTab>;
  let router: Router;
  let inert: boolean;
  let missing: string[];
  let navigated: ViewId[];

  /** Where the user is: view, row and panel, as one string. */
  const where = (): string => {
    const tab = tabs[router.activeView()];
    const panel = tab.panel ? ` ${tab.panel.kind}:${tab.panel.ref.id}` : '';
    return `${tab.view}${tab.selection ? `@${tab.selection}` : ''}${panel}`;
  };

  beforeEach(() => {
    tabs = {
      stacks: new FakeTab('stacks'),
      containers: new FakeTab('containers'),
      images: new FakeTab('images'),
      volumes: new FakeTab('volumes'),
      networks: new FakeTab('networks'),
    };
    tabs.containers.rows = ['c1', 'c2'];
    tabs.volumes.rows = ['v1', 'v2'];
    inert = false;
    missing = [];
    navigated = [];
    const host: RouterHost = {
      isInert: () => inert,
      onNavigated: (view) => navigated.push(view),
      onMissing: (ref, reason) => missing.push(`${reason}:${ref.id}`),
    };
    router = new Router(tabs, host, 'containers');
    router.start();
  });

  it('starts on the initial view', () => {
    expect(router.activeView()).toBe('containers');
    expect(tabs.containers.log).toEqual(['show']);
    expect(navigated).toEqual(['containers']);
  });

  it('walks the documented example: link out, Esc, then back and forward', () => {
    tabs.containers.selection = 'c1';
    router.open('containers', { kind: 'detail', ref: ctr('c1') });
    expect(where()).toBe('containers@c1 detail:c1');

    router.follow(vol('v2'));
    expect(where()).toBe('volumes@v2 detail:v2');

    router.open('volumes', null); // Esc: close, staying in Volumes
    expect(where()).toBe('volumes@v2');

    router.back();
    expect(where()).toBe('volumes@v2 detail:v2');
    router.back();
    expect(where()).toBe('containers@c1 detail:c1');
    router.back();
    expect(where()).toBe('containers@c1');
    expect(router.back()).toBe(false);

    router.forward();
    router.forward();
    expect(where()).toBe('volumes@v2 detail:v2');
  });

  it('snapshots where the user left before each step', () => {
    router.switchTo('volumes');
    tabs.volumes.selection = 'v2'; // moved the cursor; not a step
    router.switchTo('containers');
    router.back();
    expect(where()).toBe('volumes@v2');
  });

  it('brings back the focus a panel had when the user left it', () => {
    router.open('containers', { kind: 'detail', ref: ctr('c1') });
    tabs.containers.panel = { kind: 'detail', ref: ctr('c1'), focus: { section: 'mounts', row: '/data' } };
    router.follow(vol('v1'));
    router.back();
    expect(tabs.containers.panel?.focus).toEqual({ section: 'mounts', row: '/data' });
  });

  it('switches tabs only when the view changes, hiding only the active one', () => {
    router.open('containers', { kind: 'detail', ref: ctr('c1') });
    router.open('containers', null);
    expect(tabs.containers.log).toEqual(['show', 'restore:detail:c1', 'restore:c1']);

    router.switchTo('volumes');
    expect(tabs.containers.log.at(-1)).toBe('hide');
    expect(tabs.volumes.log).toEqual(['show', 'restore:-']);
    for (const v of ['stacks', 'images', 'networks'] as const) expect(tabs[v].log).toEqual([]);
  });

  it('switching to the view already shown replaces the entry instead of adding one', () => {
    router.switchTo('volumes');
    router.switchTo('volumes');
    router.back();
    expect(where()).toBe('containers');
    expect(router.back()).toBe(false);
  });

  it('ignores panel requests from a view that is not active', () => {
    expect(router.open('volumes', { kind: 'detail', ref: vol('v1') })).toBe(false);
    expect(router.activeView()).toBe('containers');
  });

  it('a link to something not listed yet reports it and stays put', () => {
    expect(router.follow(vol('new'))).toBe(false);
    expect(missing).toEqual(['unlisted:new']);
    expect(where()).toBe('containers');
  });

  it('a step whose target has gone lands on the list and says so', () => {
    router.follow(vol('v1'));
    router.switchTo('containers');
    tabs.volumes.rows = ['v2']; // v1 removed meanwhile
    router.back();
    expect(missing).toEqual(['gone:v1']);
    expect(router.activeView()).toBe('volumes');
    expect(tabs.volumes.panel).toBeUndefined();
  });

  it('does nothing while inert', () => {
    router.switchTo('volumes');
    inert = true;
    expect(router.back()).toBe(false);
    expect(router.switchTo('images')).toBe(false);
    expect(router.follow(ctr('c1'))).toBe(false);
    expect(router.open('volumes', { kind: 'detail', ref: vol('v1') })).toBe(false);
    expect(where()).toBe('volumes');
  });

  it('tells the host after every step', () => {
    router.switchTo('volumes');
    router.back();
    expect(navigated).toEqual(['containers', 'volumes', 'containers']);
  });
});
