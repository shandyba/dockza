import blessed from 'neo-blessed';
import { C, t } from '@theme';

type HideHandler = () => void;

interface KeyEvent {
  full: string;
}

const CLOSE_KEYS = new Set(['escape', 'h', 'q', 'C-c']);

/**
 * Key-binding reference. Owns the keyboard while open (`screen.grabKeys`, like the copy menu):
 * otherwise every view's `screen.key` handlers keep firing underneath — `d` would open a "Remove
 * container?" hidden behind this box, and Esc would close the panel below instead of the help.
 */
export class HelpOverlay {
  private screen: blessed.Widgets.Screen;
  private box: blessed.Widgets.BoxElement;
  private visible = false;
  private hideHandlers: HideHandler[] = [];

  private readonly handleKey = (_ch: unknown, key: KeyEvent) => {
    if (this.visible && CLOSE_KEYS.has(key.full)) this.hide();
  };

  // Focus moved elsewhere (a mouse click): close so grabKeys can't strand the keyboard. blessed
  // also blurs an element it re-focuses (`next` is the element itself) — that is not leaving.
  private readonly handleBlur = (next?: unknown) => {
    if (this.visible && next !== this.box) this.hide();
  };

  constructor(screen: blessed.Widgets.Screen) {
    this.screen = screen;

    this.box = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '70%',
      height: '85%',
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      keys: true,
      vi: true,
      border: { type: 'line' },
      style: {
        bg: C.bgSoft,
        border: { fg: C.accent },
      },
      hidden: true,
    });

    screen.append(this.box);

    // Scrolling (`keys` / `vi`) stays with the box's own handlers; this only adds the ways out.
    this.box.on('keypress', this.handleKey);
    this.box.on('blur', this.handleBlur);
  }

  on(event: 'hide', handler: HideHandler): void {
    if (event === 'hide') this.hideHandlers.push(handler);
  }

  show(): void {
    this.visible = true;
    this.box.setContent(this.buildContent());
    this.screen.saveFocus();
    this.box.show();
    this.box.setFront();
    this.box.focus();
    this.screen.grabKeys = true;
    this.screen.render();
  }

  hide(): void {
    if (!this.visible) return;
    // Cleared first: restoring focus blurs this box, and the blur handler must see it closed.
    this.visible = false;
    this.screen.grabKeys = false;
    this.screen.restoreFocus();
    this.box.hide();
    this.hideHandlers.forEach((h) => h());
    this.screen.render();
  }

  isVisible(): boolean {
    return this.visible;
  }

  private buildContent(): string {
    const KW = 20;
    const row = (key: string, desc: string): string => `  ${t.aqua(key.padEnd(KW))}${t.fg(desc)}`;
    const section = (name: string): string => `\n  ${t.accent(name)}\n`;

    return [
      `  {bold}${t.accent('dockza — key bindings')}{/bold}`,
      section('Navigation'),
      row('1 … 5', 'Jump to Stacks / Containers / Images / Volumes / Networks'),
      row('Tab / Shift+Tab', 'Cycle views (in a detail panel: move between its sections)'),
      row('[ / ]', 'Back / forward through the screens you visited (also Alt+← / Alt+→)'),
      row('h', 'Toggle this help'),
      row('q / Ctrl+C', 'Quit'),
      section('Stacks view'),
      row('↑ ↓ / j k', 'Navigate the tree'),
      row('→', 'Expand the selected stack'),
      row('←', 'Collapse the selected stack (or jump to its header)'),
      row('Enter', 'On a stack: toggle expansion. On a service: open detail.'),
      row('l', 'Open log viewer for the selected service'),
      row('x', "Open an external terminal exec'd into the service"),
      row('s / r / k', 'Stop / restart / kill the running service (confirm dialog)'),
      row('S', 'Start a stopped service'),
      row('d', 'Remove a stopped service (confirm dialog)'),
      row('/', 'Filter stacks and services (Esc cancels)'),
      section('Containers view'),
      row('↑ ↓ / j k', 'Navigate list'),
      row('Enter', 'Open detail panel'),
      row('l', 'Open log viewer'),
      row('x', 'Shell into container'),
      row('s / r / k', 'Stop / restart / kill running container'),
      row('S', 'Start stopped container'),
      row('d', 'Remove stopped container'),
      section('Detail panel'),
      row('Tab / Shift+Tab', 'Put the cursor on the next / previous section (MOUNTS, ENV, USED BY)'),
      row('Enter', 'On a mount or a USED BY row: open the volume / container it names'),
      row('e', 'Show / hide environment variables'),
      row('y', 'Copy menu (see below)'),
      row('l', 'Open log viewer'),
      row('s / r / k', 'Stop / restart / kill running container (confirm)'),
      row('S', 'Start stopped container'),
      row('d', 'Remove stopped container, or unused volume (confirm)'),
      row('x', 'Shell into running container'),
      row('↑ ↓', 'Scroll, or with a section selected: move in it (past either end: scroll)'),
      row('PgUp PgDn Home End', 'Page / jump'),
      row('Esc', 'Close detail panel'),
      section('Environment variables (shown with e)'),
      row('↑ ↓', 'Select a variable (past either end: scroll the panel)'),
      row('PgUp PgDn Home End', 'Move the selection a page / to either end'),
      row('Enter', "Toggle the selected variable's full value"),
      row('→ / ←', 'Expand / collapse the selected value'),
      row('E', 'Expand all values, or collapse them all'),
      section('Copy menu (y): copies from the selected row, or the panel itself'),
      row('n', "Name: of the container / volume, variable, mount's volume, or user"),
      row('i', 'Container ID'),
      row('m / p', 'Image (container) / mountpoint (volume)'),
      row('v', 'Value of the selected variable'),
      row('s / d', "A mount's source (host) path / its path in the container"),
      row('y', 'NAME=value, or a mount as a docker -v spec'),
      row('a', 'All of them: variables, -v specs, or user names, one per line'),
      row('Esc', 'Cancel'),
      section('Log viewer'),
      row('f', 'Toggle follow mode'),
      row('g', 'Scroll to top'),
      row('G', 'Scroll to bottom (re-enables follow)'),
      row('↑ / k', 'Scroll up (disables follow)'),
      row('Esc', 'Close log viewer'),
      section('Help overlay'),
      row('h', 'Toggle this help (open or close)'),
      row('Esc / q', 'Close this help'),
      section('Images, Volumes & Networks'),
      row('↑ ↓ / j k', 'Navigate list'),
      row('Enter', 'Volumes: open detail (what uses it, where it came from)'),
      row('d', 'Delete unused item'),
      section('Confirm dialog'),
      row('y / Y', 'Confirm action'),
      row('n / N / Esc', 'Cancel'),
    ].join('\n');
  }
}
