import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type blessed from 'neo-blessed';
import * as containersApi from '@docker/containers';
import * as stacksApi from '@docker/stacks';
import type { ContainerInfo } from '@models/docker';
import { groupIntoStacks, NO_STACK, type Stack, type StackResources } from '@utils/stacks';
import type { ActionDialog } from '@ui/containers/confirm-dialog';
import { containerRemoveDialog, containerStopDialog } from '@ui/containers/container-actions';
import { stackDownDialog, stackStart, stackStopDialog } from '@ui/stacks/stack-actions';
import { StacksTab } from '@ui/stacks/stacks-tab';
import type { TabNav } from '@ui/view-tab';
import type { AlsoChanges } from '@ui/widgets';
import { endpoint, makeContainer, makeNetwork, makeVolume } from '../fixtures';
import { KEY, makeScreen, press } from './headless';

// Nothing reaches a daemon: every docker call is a recorded no-op.
vi.mock('@docker/containers');
vi.mock('@docker/stacks');

const ANON = 'a'.repeat(64);
const labels = { 'com.docker.compose.project': 'shop' };
const compose = (service: string, dependsOn: string[] = []) => ({
  project: 'shop',
  service,
  configFiles: [],
  dependsOn,
  oneoff: false,
});
const mount = (name: string, destination: string) => ({
  type: 'volume' as const,
  name,
  source: '',
  destination,
  mode: '',
  rw: true,
});

const db = makeContainer({
  id: 'c-db',
  name: 'shop-db-1',
  labels,
  compose: compose('db'),
  mounts: [mount('shop_data', '/data'), mount(ANON, '/var/lib/postgresql/data')],
});
const api = makeContainer({ id: 'c-api', name: 'shop-api-1', labels, compose: compose('api', ['db']) });
const loner = makeContainer({ id: 'c-x', name: 'loner', networks: [endpoint('bridge')] });
const user = (c: ContainerInfo) => ({
  id: c.id,
  name: c.name,
  status: c.status,
  exitCode: 0,
  ip: '',
  aliases: [],
});

const resources: StackResources = {
  volumes: [
    makeVolume('shop_data', { stack: 'shop', users: [{ ...user(db), destination: '/data', rw: true }] }),
    makeVolume('other_data', { stack: 'other' }),
  ],
  networks: [
    makeNetwork('shop_default', { users: [user(db), user(api)] }),
    // Shared with a container outside the stack: down must leave it.
    makeNetwork('shop_front', { stack: 'shop', users: [user(api), user(loner)] }),
  ],
};

const stackOf = (containers: ContainerInfo[], id = 'shop'): Stack =>
  groupIntoStacks(containers).find((s) => s.id === id) as Stack;

const keys = (d: ActionDialog) => d.choices.map((c) => c.key);
const choice = (d: ActionDialog, key: string) => {
  const c = d.choices.find((x) => x.key === key);
  if (!c) throw new Error(`no choice ${key}`);
  return c;
};

beforeEach(() => vi.resetAllMocks());

describe('container dialogs', () => {
  it('stop offers stop, remove, and remove -v; only rm -v changes the volumes', async () => {
    const d = containerStopDialog(db);
    expect(keys(d)).toEqual(['y', 'd', 'v']);
    expect(choice(d, 'v').disabled).toBeUndefined();
    expect(choice(d, 'v').detail).toBe('also delete its 1 anonymous volume');
    expect(choice(d, 'v').also).toEqual({ volumes: true });
    expect(choice(d, 'd').also).toBeUndefined();

    await choice(d, 'y').run();
    expect(containersApi.stopContainer).toHaveBeenCalledWith('c-db');
    expect(containersApi.removeContainer).not.toHaveBeenCalled();
  });

  it('removing a running one stops it gracefully first', async () => {
    await choice(containerStopDialog(db), 'v').run();
    expect(containersApi.stopContainer).toHaveBeenCalledWith('c-db');
    expect(containersApi.removeContainer).toHaveBeenCalledWith('c-db', { volumes: true });
  });

  it('rm -v is greyed out when the container has no anonymous volume', async () => {
    const stopped = { ...api, status: 'exited' as const };
    const d = containerRemoveDialog(stopped);
    expect(keys(d)).toEqual(['y', 'v']);
    expect(choice(d, 'v').disabled).toMatch(/no anonymous volumes/);

    await choice(d, 'y').run();
    expect(containersApi.stopContainer).not.toHaveBeenCalled();
    expect(containersApi.removeContainer).toHaveBeenCalledWith('c-api', { volumes: false });
  });
});

describe('stack dialogs', () => {
  const shop = stackOf([db, api, loner]);

  it('stop offers stop, down and down -v, counting what each removes', () => {
    const d = stackStopDialog(shop, resources);
    expect(keys(d)).toEqual(['y', 'd', 'v']);
    expect(d.message).toBe(
      '2 of 2 services running. 1 network or volume shared with other containers stays.',
    );
    expect(choice(d, 'd').detail).toBe('remove 2 containers, 1 network · keep volumes');
    // shop_data, plus db's anonymous volume.
    expect(choice(d, 'v').detail).toBe('also delete 2 volumes');
    expect(choice(d, 'd').also).toEqual({ networks: true });
    expect(choice(d, 'v').also).toEqual({ networks: true, volumes: true });
  });

  it('stop stops dependents first', async () => {
    await choice(stackStopDialog(shop, resources), 'y').run();
    expect(stacksApi.stopStack).toHaveBeenCalledWith('shop', [
      [{ id: 'c-api', name: 'shop-api-1' }],
      [{ id: 'c-db', name: 'shop-db-1' }],
    ]);
  });

  it('down -v removes its own networks and volumes, not the shared ones', async () => {
    await choice(stackDownDialog(shop, resources), 'v').run();
    expect(stacksApi.downStack).toHaveBeenCalledWith(
      'shop',
      {
        stop: [[{ id: 'c-api', name: 'shop-api-1' }], [{ id: 'c-db', name: 'shop-db-1' }]],
        containers: [
          { id: 'c-api', name: 'shop-api-1' },
          { id: 'c-db', name: 'shop-db-1' },
        ],
        networks: [{ id: 'shop_default-id', name: 'shop_default' }],
        volumes: ['shop_data'],
      },
      { volumes: true },
    );
  });

  it('down -v is greyed out with no volumes; down on a stopped stack stops nothing', async () => {
    const stopped = stackOf([{ ...api, status: 'exited' }]);
    const d = stackDownDialog(stopped, { volumes: [], networks: [] });
    expect(keys(d)).toEqual(['y', 'v']);
    expect(choice(d, 'v').disabled).toBe('no volumes');
    expect(choice(d, 'y').detail).toBe('remove 1 container · keep volumes');

    await choice(d, 'y').run();
    expect(stacksApi.downStack).toHaveBeenCalledWith('shop', {
      stop: [],
      containers: [{ id: 'c-api', name: 'shop-api-1' }],
      networks: [],
      volumes: [],
    });
  });

  it('start starts its stopped services, dependencies first; null when none is stopped', async () => {
    expect(stackStart(shop)).toBeNull();
    const down = stackOf([
      { ...db, status: 'exited' },
      { ...api, status: 'created' },
    ]);
    const start = stackStart(down);
    expect(start?.count).toBe(2);
    await start?.run();
    expect(stacksApi.startStack).toHaveBeenCalledWith('shop', [
      [{ id: 'c-db', name: 'shop-db-1' }],
      [{ id: 'c-api', name: 'shop-api-1' }],
    ]);
  });
});

/**
 * Widget tests, against the bar in CONTRIBUTING.md: the dialog's `d` is the tab's `d` too, and only
 * blessed's key routing (`grabKeys`) keeps the tab's from firing underneath it.
 */
describe('Stacks: stack keys on a stack header', () => {
  const DIMS = { top: 0, left: 0, width: '100%', height: '100%' };
  let screen: blessed.Widgets.Screen;
  let tab: StacksTab;
  let runs: Array<AlsoChanges | undefined>;
  let errors: string[];

  beforeEach(() => {
    screen = makeScreen(120, 30);
    runs = [];
    errors = [];
    const nav: TabNav = {
      open: (panel) => tab.restore({ ...tab.location(), panel: panel ?? undefined }),
      follow: () => {},
    };
    tab = new StacksTab(
      screen,
      DIMS,
      async (action, also) => {
        runs.push(also);
        await action();
      },
      nav,
    );
    tab.on('error', (msg) => errors.push(msg));
    tab.show();
    const containers = [db, api, loner];
    tab.setData(containers, groupIntoStacks(containers));
    tab.setResources(resources.volumes, resources.networks);
  });

  afterEach(() => {
    screen.destroy();
  });

  it('s opens the stop dialog; its d takes the stack down once, and the tab does not also act', async () => {
    expect(tab.location().selection).toBe('s:shop');
    expect(tab.footerContext()).toBe('stacks-tree-stack-live');
    press(screen, 's');
    expect(tab.isInert()).toBe(true);
    press(screen, 'd');
    await vi.waitFor(() => expect(stacksApi.downStack).toHaveBeenCalledTimes(1));
    expect(stacksApi.downStack).toHaveBeenCalledWith('shop', expect.anything()); // no `-v`
    expect(runs).toEqual([{ networks: true }]);
    expect(tab.isInert()).toBe(false); // no second dialog from the tab's own `d`
    expect(containersApi.removeContainer).not.toHaveBeenCalled();
  });

  it('Esc cancels, and nothing runs', () => {
    press(screen, 's');
    press(screen, KEY.escape);
    expect(tab.isInert()).toBe(false);
    expect(runs).toEqual([]);
  });

  it('S on a live stack with nothing stopped says so', () => {
    press(screen, 'S');
    expect(errors).toEqual(['Every service in shop is already running']);
    expect(runs).toEqual([]);
  });

  it('(no stack) is not a project: its header takes no stack keys', () => {
    press(screen, KEY.left); // collapse shop
    press(screen, KEY.down);
    expect(tab.location().selection).toBe(`s:${NO_STACK}`);
    expect(tab.footerContext()).toBe('stacks-tree-stack');
    press(screen, 'd');
    expect(tab.isInert()).toBe(false);
    expect(errors).toHaveLength(1);
  });

  it('on a service row, s is the container stop dialog', async () => {
    press(screen, KEY.down); // shop's first service
    press(screen, 's');
    expect(tab.isInert()).toBe(true);
    press(screen, 'y');
    await vi.waitFor(() => expect(containersApi.stopContainer).toHaveBeenCalledTimes(1));
    expect(stacksApi.stopStack).not.toHaveBeenCalled();
  });
});
