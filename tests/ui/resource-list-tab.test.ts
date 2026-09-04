import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'stream';
import blessed from 'neo-blessed';
import { ResourceListTab } from '@ui/resource-list-tab';
import type { ResourceListConfig } from '@ui/resource-list-tab';
import type { RunMutation } from '@ui/widgets';
import { RefreshGate } from '@utils/refresh-gate';

/**
 * We otherwise don't test blessed widgets (see CONTRIBUTING.md), but the reappearing-row bug
 * lived in the seam between the tab and App's poller, so the regression test has to exercise
 * a real tab wired to a real gate exactly the way App wires them.
 */

interface Item {
  id: string;
  name: string;
}

const A: Item = { id: 'a', name: 'alpha' };
const B: Item = { id: 'b', name: 'beta' };

/** Headless screen. Streams must be injected — under a pipe blessed reports cols/rows of 1. */
function makeScreen(): blessed.Widgets.Screen {
  const input: any = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => input;
  const output: any = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 40;
  output.resume();
  return blessed.screen({ input, output, terminal: 'xterm-256color', smartCSR: true });
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Drains the promise chains behind the confirm dialog's fire-and-forget `void` call. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r));
}

function rowsOf(tab: ResourceListTab<Item>): string[] {
  return (tab.list as any).items.map((i: any) => String(i.getContent()).trim());
}

function makeConfig(remove: (item: Item) => Promise<void>): ResourceListConfig<Item> {
  return {
    remove,
    getKey: (item) => item.id,
    emptyMessage: 'No items',
    confirmTitle: 'Remove item?',
    confirmLabel: (item) => item.name,
    guards: [],
    columns: [{ header: 'NAME', weight: 0, render: (item) => item.name }],
  };
}

describe('ResourceListTab deletion vs. in-flight poll', () => {
  let screen: blessed.Widgets.Screen;

  beforeEach(() => {
    screen = makeScreen();
  });

  afterEach(() => {
    screen.destroy();
  });

  it('does not let a poll issued before the delete resurrect the removed row', async () => {
    const staleListing = deferred<Item[]>();
    // First call is the poll that straddles the delete; second is the forced post-delete refetch.
    const listings: Promise<Item[]>[] = [staleListing.promise, Promise.resolve([A])];
    let listCalls = 0;

    // The gate is built before the tab (the tab needs the runner the gate backs), so the apply
    // step is late-bound — App does the same thing by closing over `this.imagesTab`.
    let applyItems: (items: Item[]) => void = () => {};

    // Mirrors App.fetchImages: fetch, re-check the token, only then apply.
    const gate = new RefreshGate(async (token) => {
      const items = await listings[listCalls++];
      if (!gate.isCurrent(token)) return;
      applyItems(items);
    });

    // Mirrors App.mutationRunner.
    const runMutation: RunMutation = async (action) => {
      gate.invalidate();
      try {
        await action();
      } finally {
        await gate.force();
      }
    };

    const removed: string[] = [];
    const tab = new ResourceListTab<Item>(
      screen,
      { top: 0, left: 0, width: '100%', height: '100%' },
      makeConfig(async (item) => {
        removed.push(item.id);
      }),
      runMutation,
    );
    applyItems = (items) => tab.setData(items);

    tab.show();
    tab.setData([A, B]);
    expect(rowsOf(tab)).toEqual(['alpha', 'beta']);

    // A poll is issued and its listing has NOT come back yet.
    const inFlightPoll = gate.poll();
    await settle();

    // The user deletes beta while that poll is still outstanding.
    tab.list.select(1);
    screen.emit('key d');
    screen.emit('key y');
    await settle();

    expect(removed).toEqual(['b']);
    expect(rowsOf(tab)).toEqual(['alpha']);

    // Now the pre-delete snapshot finally lands. It must be dropped, not rendered.
    staleListing.resolve([A, B]);
    await inFlightPoll;
    await settle();

    expect(rowsOf(tab)).toEqual(['alpha']);
    expect(listCalls).toBe(2);
  });

  it('routes deletion through the injected runner and never lists on its own', async () => {
    let runnerCalls = 0;
    const removed: string[] = [];

    const runMutation: RunMutation = async (action) => {
      runnerCalls++;
      await action();
    };

    const tab = new ResourceListTab<Item>(
      screen,
      { top: 0, left: 0, width: '100%', height: '100%' },
      makeConfig(async (item) => {
        removed.push(item.id);
      }),
      runMutation,
    );

    tab.show();
    tab.setData([A, B]);

    tab.list.select(1);
    screen.emit('key d');
    screen.emit('key y');
    await settle();

    expect(runnerCalls).toBe(1);
    expect(removed).toEqual(['b']);
    // The runner did no refetch, so the tab still shows what App last gave it — it never
    // fetches a replacement listing itself.
    expect(rowsOf(tab)).toEqual(['alpha', 'beta']);
  });
});
