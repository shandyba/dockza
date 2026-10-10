import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type blessed from 'neo-blessed';
import type { Hint } from '@ui/footer';
import { ResourceListTab, type ResourceListConfig } from '@ui/resource-list-tab';
import { KEY, makeScreen, press } from './headless';

/**
 * Widget tests, against the bar in CONTRIBUTING.md: marks live in blessed's key routing — Space and
 * `a` on the list, one Esc shared with the filter, `d` and `D` on the screen under a dialog that owns
 * the keyboard — which no pure unit has.
 */

const DIMS = { top: 0, left: 0, width: '100%', height: '100%' };

interface Item {
  id: string;
  name: string;
  inUse?: boolean;
  dangling?: boolean;
}

const ITEMS: Item[] = [
  { id: 'a', name: 'alpha', dangling: true },
  { id: 'b', name: 'beta', inUse: true },
  { id: 'c', name: 'gamma', dangling: true },
  { id: 'd', name: 'delta' },
];

/** Drains the promise chains behind the confirm dialog's fire-and-forget `void` call. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r));
}

const rowsOf = (tab: ResourceListTab<Item>): string[] =>
  (tab.list as any).items.map((i: any) => String(i.getText()).trimEnd());

const marksOf = (tab: ResourceListTab<Item>): string => {
  const box = (tab as any).marksBox as blessed.Widgets.BoxElement;
  return box.hidden ? '' : box.getText().trim();
};

const dialogOf = (tab: ResourceListTab<Item>): string => {
  const dialog = (tab as any).confirmDialog;
  return dialog.isVisible() ? String(dialog.box.getText()) : '';
};

const hintsOf = (tab: ResourceListTab<Item>): string =>
  (tab.footerContext() as Hint[]).map((h) => `${h.key} ${h.verb}`).join(' · ');

describe('marking rows on a resource list', () => {
  let screen: blessed.Widgets.Screen;
  let tab: ResourceListTab<Item>;
  let removed: string[];
  let failOn: string[];
  let info: string[];
  let errors: string[];

  function makeTab(extra: Partial<ResourceListConfig<Item>> = {}): ResourceListTab<Item> {
    const config: ResourceListConfig<Item> = {
      view: 'volumes',
      footer: 'volumes',
      noun: 'item',
      remove: async (item) => {
        if (failOn.includes(item.id)) throw new Error(`no ${item.name}`);
        removed.push(item.id);
      },
      getKey: (item) => item.id,
      emptyMessage: 'No items',
      confirmTitle: 'Remove item?',
      confirmLabel: (item) => item.name,
      guards: [(item) => (item.inUse ? 'Item in use — cannot delete' : null)],
      columns: [{ header: 'NAME', weight: 0, render: (item) => item.name }],
      filterFields: (item) => [item.name],
      ...extra,
    };
    // Mirrors App's runner: the listing is fetched again once the mutation is done.
    const t = new ResourceListTab<Item>(
      screen,
      DIMS,
      config,
      async (action) => {
        try {
          await action();
        } finally {
          t.setData(ITEMS.filter((i) => !removed.includes(i.id)));
        }
      },
      { open: () => {}, follow: () => {} },
    );
    t.on('info', (m) => info.push(m));
    t.on('error', (m) => errors.push(m));
    t.show();
    t.setData(ITEMS);
    return t;
  }

  beforeEach(() => {
    screen = makeScreen();
    removed = [];
    failOn = [];
    info = [];
    errors = [];
    tab = makeTab();
  });

  afterEach(() => {
    screen.destroy();
  });

  it('Space marks the row and moves down; again unmarks it', () => {
    press(screen, ' ');
    press(screen, ' ');
    expect(rowsOf(tab)).toEqual(['✓ alpha', '✓ beta', '  gamma', '  delta']);
    expect(marksOf(tab)).toBe('2 marked');

    press(screen, KEY.up);
    press(screen, ' ');
    expect(rowsOf(tab)).toEqual(['✓ alpha', '  beta', '  gamma', '  delta']);
    expect(marksOf(tab)).toBe('1 marked');
  });

  it('a marks every row the filter shows, and again unmarks them; hidden rows keep theirs', () => {
    press(screen, KEY.end);
    press(screen, ' '); // delta
    press(screen, '/');
    press(screen, 'mm'); // gamma
    press(screen, KEY.enter);
    press(screen, 'a');
    expect(rowsOf(tab)).toEqual(['✓ gamma']);
    expect(marksOf(tab)).toBe('2 marked');

    press(screen, 'a');
    expect(marksOf(tab)).toBe('1 marked');
  });

  it('Esc clears the filter first, then the marks', () => {
    press(screen, 'a');
    press(screen, '/');
    press(screen, 'al');
    press(screen, KEY.enter);
    press(screen, KEY.escape);
    expect(rowsOf(tab)).toHaveLength(4);
    expect(marksOf(tab)).toBe('4 marked');

    press(screen, KEY.escape);
    expect(marksOf(tab)).toBe('');
    expect(rowsOf(tab)[0]).toBe('  alpha');
  });

  it('the footer says how many d takes, and offers a and Esc', () => {
    expect(tab.footerContext()).toBe('volumes');
    press(screen, ' ');
    press(screen, ' ');
    expect(hintsOf(tab)).toContain('d delete 2 · D clean up · Space mark · a all · Esc unmark · / filter');
  });

  it('d deletes every marked row, hidden by the filter or not, and skips what a guard keeps', async () => {
    press(screen, 'a');
    press(screen, '/');
    press(screen, 'gamma');
    press(screen, KEY.enter);
    press(screen, 'd');
    expect(dialogOf(tab)).toContain('Remove 3 items?');
    expect(dialogOf(tab)).toContain(
      "alpha, gamma and delta will be permanently deleted. 2 of them are hidden by the filter. 1 more marked can't be deleted and stay marked.",
    );

    press(screen, 'y');
    await settle();
    expect(removed).toEqual(['a', 'c', 'd']);
    expect(info).toEqual(['Removing 3 items…', 'Removed 3 items']);
    // The one kept is still marked, so it's plain what didn't go.
    expect(marksOf(tab)).toBe('1 marked');
  });

  it('d keeps marked a row that failed to go, and says which', async () => {
    failOn = ['c'];
    press(screen, ' '); // alpha
    press(screen, KEY.down);
    press(screen, ' '); // gamma
    press(screen, 'd');
    press(screen, 'y');
    await settle();
    expect(removed).toEqual(['a']);
    expect(errors).toEqual(["Removed 1 of 2 items; couldn't remove gamma — no gamma"]);
    expect(rowsOf(tab)).toEqual(['  beta', '✓ gamma', '  delta']);
  });

  it('d with only guarded rows marked says why, and asks nothing', () => {
    press(screen, KEY.down);
    press(screen, ' '); // beta
    press(screen, 'd');
    expect(dialogOf(tab)).toBe('');
    expect(errors).toEqual(['Item in use — cannot delete']);
  });

  it('n cancels and keeps the marks', () => {
    press(screen, 'a');
    press(screen, 'd');
    press(screen, 'n');
    expect(removed).toEqual([]);
    expect(marksOf(tab)).toBe('4 marked');
  });

  describe('D', () => {
    beforeEach(() => {
      screen.destroy();
      screen = makeScreen();
      tab = makeTab({
        cleanups: [
          { key: 'd', label: 'Dangling', detail: 'nothing mounts them', matches: (i) => i.dangling === true },
          { key: 'u', label: 'All unused', detail: 'everything unused', matches: (i) => !i.inUse },
        ],
      });
    });

    it('offers each kind with its count, and deletes the one picked', async () => {
      press(screen, 'D');
      expect(dialogOf(tab)).toContain('Clean up items?');
      expect(dialogOf(tab)).toMatch(/\[d\] Dangling\s+2 items {3}nothing mounts them/);
      expect(dialogOf(tab)).toMatch(/\[u\] All unused\s+3 items {3}everything unused/);

      press(screen, 'd');
      await settle();
      expect(removed).toEqual(['a', 'c']);
      expect(info).toEqual(['Removing 2 items…', 'Removed 2 items']);
    });

    it('looks only at the rows the filter shows, and never at what is in use', async () => {
      press(screen, '/');
      press(screen, 'ta'); // beta, delta
      press(screen, KEY.enter);
      press(screen, 'D');
      expect(dialogOf(tab)).toContain('Only among the 2 the filter shows.');
      expect(dialogOf(tab)).toMatch(/\[d\] Dangling\s+none/);

      press(screen, 'd'); // disabled: does nothing
      expect(dialogOf(tab)).toContain('Clean up items?');
      press(screen, 'u');
      await settle();
      expect(removed).toEqual(['d']);
    });

    it('is not bound where the list offers no clean-up', () => {
      screen.destroy();
      screen = makeScreen();
      tab = makeTab();
      press(screen, 'D');
      expect(dialogOf(tab)).toBe('');
    });
  });
});
