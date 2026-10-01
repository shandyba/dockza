import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type blessed from 'neo-blessed';
import type { ContainerInfo } from '@models/docker';
import { ContainerDetail } from '@ui/containers/container-detail';
import { KEY, makeScreen, press } from './headless';

/**
 * We otherwise don't test blessed widgets (see CONTRIBUTING.md), but two things here only exist
 * against a real screen: the copy menu owning the keyboard (it must mute the tab's `screen.key`
 * handlers — a stray `k` is "kill container"), and blessed wrapping our pre-wrapped lines behind
 * our back, which would scroll the selection off screen. Keys are typed as raw bytes so blessed's
 * real parser and its `grabKeys` routing are what's under test.
 */

// Comfortably wider than the 100-column test screen, so it is always truncated until expanded.
const LONG_PATH =
  'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/lib/postgresql/18/bin:/opt/tools/bin:/home/app/.local/bin';
const PATH_VALUE = LONG_PATH.slice('PATH='.length);

function container(env: string[], extra: Partial<ContainerInfo> = {}): ContainerInfo {
  return {
    id: 'b5322c040ce6aaaaaaaa',
    name: 'db-pr02',
    image: 'postgres:18',
    status: 'exited',
    exitCode: 0,
    uptime: 'a day ago',
    ports: [],
    networks: ['db-pr02_default'],
    ip: '',
    mounts: [],
    env,
    restartPolicy: 'no',
    pids: 0,
    labels: {},
    ...extra,
  };
}

/** Lets the copy promise chain (fire-and-forget inside the panel) finish. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
}

const content = (d: ContainerDetail): string => (d.box as any).content as string;
const sourceLines = (d: ContainerDetail): string[] => content(d).split('\n');
/** Content line holding the selection highlight (its first line, for an expanded value). */
const selectedLine = (d: ContainerDetail): number => sourceLines(d).findIndex((l) => l.includes('-bg}'));
const viewport = (d: ContainerDetail): number => Number(d.box.height) - Number(d.box.iheight);

describe('ContainerDetail env navigation and copy', () => {
  let screen: blessed.Widgets.Screen;
  let detail: ContainerDetail;
  let copies: string[];
  let infos: string[];
  let modes: boolean[];

  beforeEach(() => {
    screen = makeScreen(100, 30);
    copies = [];
    infos = [];
    modes = [];
    detail = new ContainerDetail(screen, { top: 0, left: 0, width: '100%', height: '100%' }, async (text) => {
      copies.push(text);
      return { ok: true, method: 'native', tool: 'fake' };
    });
    detail.on('info', (m) => infos.push(m));
    detail.on('env-mode', (active) => modes.push(active));
  });

  afterEach(() => {
    screen.destroy();
  });

  it('the copy menu owns the keyboard: screen keys stay silent until it closes', () => {
    const kill = vi.fn();
    screen.key(['k'], kill); // stands in for the tab's kill binding
    detail.show(container(['A=1', 'B=2']));

    press(screen, 'k');
    expect(kill).toHaveBeenCalledTimes(1);

    press(screen, 'y');
    expect(screen.grabKeys).toBe(true);
    press(screen, 'k');
    press(screen, 'h');
    expect(kill).toHaveBeenCalledTimes(1);

    press(screen, KEY.escape);
    expect(screen.grabKeys).toBe(false);
    expect(detail.isVisible()).toBe(true); // Esc closed the menu, not the panel

    press(screen, 'k');
    expect(kill).toHaveBeenCalledTimes(2);
  });

  it('copies the selected name, value, NAME=value, and all variables', async () => {
    detail.show(container(['TZ=UTC', LONG_PATH]));
    press(screen, 'e');
    press(screen, KEY.down);

    for (const key of ['n', 'v', 'y', 'a']) {
      press(screen, 'y');
      press(screen, key);
    }
    await settle();

    expect(copies).toEqual(['PATH', PATH_VALUE, LONG_PATH, `TZ=UTC\n${LONG_PATH}`]);
    expect(infos[0]).toBe('Copied name PATH');
    expect(infos[1]).toBe(`Copied value of PATH (${PATH_VALUE.length} chars)`);
    expect(infos).toHaveLength(4);
  });

  it('with ENV hidden, only "all" can be copied', async () => {
    detail.show(container(['A=1', 'B=2']));
    press(screen, 'y');
    press(screen, 'n'); // disabled: ignored, menu stays open
    expect(screen.grabKeys).toBe(true);
    press(screen, 'a');
    await settle();
    expect(copies).toEqual(['A=1\nB=2']);
  });

  it('reports instead of opening an empty menu when there are no variables', () => {
    detail.show(container([]));
    press(screen, 'y');
    expect(screen.grabKeys).toBe(false);
    expect(infos).toEqual(['No environment variables to copy']);
  });

  it('e toggles navigation mode and tells listeners', () => {
    detail.show(container(['A=1']));
    press(screen, 'e');
    press(screen, 'e');
    expect(modes).toEqual([true, false]);
  });

  it('one Enter toggles a value once (blessed emits both enter and return)', () => {
    detail.show(container(['TZ=UTC', LONG_PATH]));
    press(screen, 'e');
    press(screen, KEY.down);
    const collapsed = sourceLines(detail).length;

    press(screen, KEY.enter);
    expect(sourceLines(detail).length).toBeGreaterThan(collapsed);
    expect(content(detail)).toContain('▾');

    press(screen, KEY.enter);
    expect(sourceLines(detail).length).toBe(collapsed);
  });

  it('→ / ← expand and collapse, E expands everything', () => {
    detail.show(container([LONG_PATH, 'MULTI=a\nb']));
    press(screen, 'e');
    const collapsed = sourceLines(detail).length;

    press(screen, KEY.right);
    const one = sourceLines(detail).length;
    expect(one).toBeGreaterThan(collapsed);
    press(screen, KEY.left);
    expect(sourceLines(detail).length).toBe(collapsed);

    press(screen, 'E');
    expect(sourceLines(detail).length).toBe(one + 1);
    press(screen, 'E');
    expect(sourceLines(detail).length).toBe(collapsed);
  });

  it('hide() with the menu open gives the keyboard back, and keys do nothing once hidden', () => {
    detail.show(container(['A=1']));
    press(screen, 'y');
    expect(screen.grabKeys).toBe(true);

    detail.hide(); // e.g. a poll found the container gone
    expect(screen.grabKeys).toBe(false);

    press(screen, 'e');
    press(screen, 'y');
    expect(modes).toEqual([]);
    expect(screen.grabKeys).toBe(false);
  });

  it('a poll that reorders the variables keeps the same one selected', async () => {
    detail.show(container(['A=1', 'B=2', 'C=3']));
    press(screen, 'e');
    press(screen, KEY.down);
    detail.update(container(['C=3', 'B=2', 'A=1']));

    press(screen, 'y');
    press(screen, 'n');
    await settle();
    expect(copies).toEqual(['B']);
  });

  it('pre-wraps env lines exactly as blessed lays them out, wide glyphs included', () => {
    const wide = `JP=${'東京'.repeat(120)}`;
    detail.show(container([LONG_PATH, wide, 'TAG={bold}x{/}']));
    press(screen, 'e');
    press(screen, 'E');
    const clines = (detail.box as any)._clines as unknown[];
    expect(clines.length).toBe(sourceLines(detail).length);
  });

  it('keeps the selection on screen even when lines above it wrap', () => {
    const longMount = { source: `/host/${'deep/'.repeat(40)}data`, destination: '/data', mode: '', rw: true };
    const env = Array.from({ length: 60 }, (_, i) => `VAR_${i}=value-${i}`);
    detail.show(container(env, { mounts: [longMount, longMount] }));
    press(screen, 'e');

    const visible = () => {
      const ftor: number[][] = (detail.box as any)._clines.ftor;
      const row = ftor[selectedLine(detail)][0];
      const top = detail.box.childBase;
      return row >= top && row < top + viewport(detail);
    };

    for (let i = 0; i < 45; i++) press(screen, KEY.down);
    expect(visible()).toBe(true);
    press(screen, KEY.end);
    expect(visible()).toBe(true);
    press(screen, KEY.pageUp);
    expect(visible()).toBe(true);
    press(screen, KEY.home);
    expect(visible()).toBe(true);

    // Up past the first variable scrolls the panel back to the container summary.
    press(screen, KEY.up);
    expect(detail.box.childBase).toBe(0);
  });

  it('opens a new container scrolled to the top', () => {
    const env = Array.from({ length: 60 }, (_, i) => `VAR_${i}=v`);
    detail.show(container(env));
    press(screen, 'e');
    press(screen, KEY.end);
    expect(detail.box.childBase).toBeGreaterThan(0);

    detail.hide();
    detail.show(container(env));
    expect(detail.box.childBase).toBe(0);
  });
});
