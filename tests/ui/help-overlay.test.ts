import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import blessed from 'neo-blessed';
import type { ContainerInfo } from '@models/docker';
import { HelpOverlay } from '@ui/help-overlay';
import { ContainerDetail } from '@ui/containers/container-detail';
import { KEY, makeScreen, press } from './headless';

/**
 * The help overlay sits on top of views whose actions are `screen.key` handlers. Those used to
 * keep firing while it was open (a `d` opened "Remove container?" hidden behind it), and its Esc
 * handler shared a listener list with the detail panel's — blessed's emitter walks that list live,
 * so the panel removing its own handler made the help's get skipped. Real keys, real screen.
 */

const container: ContainerInfo = {
  id: 'b5322c040ce6aaaaaaaa',
  name: 'db-pr02',
  image: 'postgres:18',
  status: 'exited',
  exitCode: 0,
  uptime: 'a day ago',
  ports: [],
  networks: [],
  ip: '',
  mounts: [],
  env: ['A=1'],
  restartPolicy: 'no',
  pids: 0,
  labels: {},
};

describe('HelpOverlay owns the keyboard while open', () => {
  let screen: blessed.Widgets.Screen;
  let help: HelpOverlay;
  let hides: number;

  beforeEach(() => {
    screen = makeScreen();
    help = new HelpOverlay(screen);
    hides = 0;
    help.on('hide', () => hides++);
  });

  afterEach(() => {
    screen.destroy();
  });

  it('keeps view actions from firing underneath, and hands the keys back on close', () => {
    // Stand-ins for a tab's remove / start / shell bindings.
    const remove = vi.fn();
    const start = vi.fn();
    const shell = vi.fn();
    screen.key(['d'], remove);
    screen.key(['S-s'], start);
    screen.key(['x'], shell);

    help.show();
    press(screen, 'd');
    press(screen, 'S');
    press(screen, 'x');
    expect(remove).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(shell).not.toHaveBeenCalled();

    press(screen, KEY.escape);
    expect(help.isVisible()).toBe(false);
    expect(screen.grabKeys).toBe(false);

    press(screen, 'd');
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('Esc over the detail panel closes the help only; the next Esc closes the panel', () => {
    const detail = new ContainerDetail(
      screen,
      { top: 0, left: 0, width: '100%', height: '100%' },
      async () => ({
        ok: true,
        method: 'native',
        tool: 'fake',
      }),
    );
    detail.show(container);
    help.show();

    press(screen, KEY.escape);
    expect(help.isVisible()).toBe(false);
    expect(detail.isVisible()).toBe(true);

    // Focus went back to the panel, so its own keys work again.
    expect(screen.focused).toBe(detail.box);
    press(screen, KEY.escape);
    expect(detail.isVisible()).toBe(false);
  });

  it.each([
    ['Esc', KEY.escape],
    ['h', 'h'],
    ['q', 'q'],
    ['Ctrl+C', '\x03'],
  ])('closes on %s, once', (_name, bytes) => {
    help.show();
    press(screen, bytes);
    expect(help.isVisible()).toBe(false);
    expect(hides).toBe(1);
  });

  it('still scrolls with its own keys', () => {
    help.show();
    for (let i = 0; i < 5; i++) press(screen, KEY.down);
    press(screen, 'j');
    expect((help as any).box.childBase).toBeGreaterThan(0);
    expect(help.isVisible()).toBe(true);
  });

  it('closes when focus is taken away, releasing the keyboard', () => {
    const elsewhere = blessed.box({ parent: screen, top: 0, left: 0, width: 10, height: 1 });
    help.show();
    elsewhere.focus();
    expect(help.isVisible()).toBe(false);
    expect(screen.grabKeys).toBe(false);
  });

  it('stays open when it already had focus (blessed blurs an element it re-focuses)', () => {
    // blessed focuses the first element attached to a screen, which here is the help box itself.
    expect(screen.focused).toBe((help as any).box);
    help.show();
    expect(help.isVisible()).toBe(true);
    expect(screen.grabKeys).toBe(true);
  });
});
