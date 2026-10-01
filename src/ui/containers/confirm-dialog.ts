import blessed from 'neo-blessed';
import { C, t } from '@theme';
import { escapeTags, visualLength } from '@utils/format';
import type { AlsoChanges } from '@ui/widgets';

/** One way to answer the dialog, picked by its key. */
export interface Choice {
  key: string;
  label: string;
  /** What it does, after the label. */
  detail?: string;
  danger?: boolean;
  /** Why it doesn't apply: shown greyed in place of the detail, and its key does nothing. */
  disabled?: string;
  onPick: () => void;
}

interface ChooseOptions {
  title: string;
  message: string;
  danger?: boolean;
  choices: Choice[];
  onCancel: () => void;
}

interface ShowOptions {
  title: string;
  message: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A choice that runs a docker mutation, and what else it changes besides the tab's own listing. */
export interface ActionChoice extends Omit<Choice, 'onPick'> {
  run: () => Promise<void>;
  also?: AlsoChanges;
  /** Said in the footer as it starts, for one that takes a while (a whole stack). */
  pending?: string;
}

/** A dialog whose every choice runs a mutation: what the container and stack actions build. */
export interface ActionDialog {
  title: string;
  message: string;
  danger?: boolean;
  choices: ActionChoice[];
}

interface KeyEvent {
  full: string;
}

const MIN_WIDTH = 52;
const CANCEL_KEYS = new Set(['n', 'S-n', 'escape', 'C-c']);

/**
 * Asks before a mutation: yes / no, or one of several ways to go about it (stop, remove, remove
 * with its volumes), each picked by its key.
 *
 * It owns the keyboard while open (`screen.grabKeys`, like the copy menu): its keys (`d`, `s`, …)
 * are a tab's keys too, and the tab's must not fire underneath.
 */
export class ConfirmDialog {
  private screen: blessed.Widgets.Screen;
  private box: blessed.Widgets.BoxElement;

  private visible = false;
  private choices: Choice[] = [];
  private onCancel: (() => void) | null = null;

  private readonly handleKey = (_ch: unknown, key: KeyEvent) => {
    if (!this.visible) return;
    if (CANCEL_KEYS.has(key.full)) {
      this.cancel();
      return;
    }
    const pressed = key.full === 'S-y' ? 'y' : key.full;
    const choice = this.choices.find((c) => c.key === pressed);
    if (!choice || choice.disabled) return;
    this.hide();
    choice.onPick();
  };

  // Focus moved elsewhere (a mouse click): a cancel, so grabKeys can't strand the keyboard. blessed
  // also blurs an element it re-focuses (`next` is the element itself) — that is not leaving.
  private readonly handleBlur = (next?: unknown) => {
    if (this.visible && next !== this.box) this.cancel();
  };

  constructor(screen: blessed.Widgets.Screen) {
    this.screen = screen;

    this.box = blessed.box({
      parent: screen,
      width: MIN_WIDTH,
      height: 9,
      top: 'center',
      left: 'center',
      tags: true,
      border: { type: 'line' },
      style: {
        bg: C.surface,
        border: { fg: C.purple },
      },
      hidden: true,
    });

    screen.append(this.box);

    this.box.on('keypress', this.handleKey);
    this.box.on('blur', this.handleBlur);
  }

  /** Yes or no. */
  show(options: ShowOptions): void {
    const danger = options.danger ?? false;
    this.choose({
      ...options,
      choices: [{ key: 'y', label: danger ? 'Yes, proceed' : 'Yes', danger, onPick: options.onConfirm }],
    });
  }

  /** One of several ways, each on its own line; `y` should be the safest. */
  choose(options: ChooseOptions): void {
    this.choices = options.choices;
    this.onCancel = options.onCancel;

    const danger = options.danger ?? false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.box as any).style.border.fg = danger ? C.red : C.purple;

    const title = escapeTags(options.title);
    const lines = [
      '',
      `  {bold}${danger ? t.red(title) : t.fg(title)}{/bold}`,
      '',
      `  ${t.comment(escapeTags(options.message))}`,
      '',
      ...this.choiceLines(options.choices),
    ];

    const maxWidth = Math.max(MIN_WIDTH, Number(this.screen.width) - 4);
    const width = Math.min(maxWidth, Math.max(MIN_WIDTH, ...lines.map((l) => visualLength(l) + 4)));
    // A line wider than the box wraps: count the rows it takes.
    const inner = width - 2;
    const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil(visualLength(l) / inner)), 0);

    this.box.width = width;
    this.box.height = rows + 2;
    this.box.setContent(lines.join('\n'));
    this.visible = true;
    this.screen.saveFocus();
    this.box.show();
    this.box.setFront();
    this.box.focus();
    this.screen.grabKeys = true;

    this.screen.render();
  }

  /** Safe to call when hidden. Doesn't call `onCancel`: the tab hiding it is not the user saying no. */
  hide(): void {
    if (!this.visible) return;
    // Cleared first: restoring focus blurs this box, and the blur handler must see it closed.
    this.visible = false;
    this.screen.grabKeys = false;
    this.screen.restoreFocus();
    this.box.hide();

    this.screen.render();
  }

  isVisible(): boolean {
    return this.visible;
  }

  private cancel(): void {
    const onCancel = this.onCancel;
    this.hide();
    onCancel?.();
  }

  private choiceLines(choices: Choice[]): string[] {
    const keyOf = (c: Choice): string => {
      const key = `[${c.key}]`;
      if (c.disabled) return t.faint(key);
      return c.danger ? t.red(key) : t.green(key);
    };

    // Yes / no keeps its one line.
    const [only] = choices;
    if (choices.length === 1 && !only.detail) {
      return [
        `  ${keyOf(only)} ${t.fg(escapeTags(only.label))}    ${t.comment('[n] Cancel')}`,
        `  ${t.comment(`${only.key}:confirm  n / Esc:cancel`)}`,
      ];
    }

    const labelW = Math.max(...choices.map((c) => c.label.length));
    return [
      ...choices.map((c) => {
        const label = escapeTags(c.label.padEnd(labelW));
        if (c.disabled) return `  ${keyOf(c)} ${t.faint(label)}  ${t.faint(escapeTags(c.disabled))}`;
        return `  ${keyOf(c)} ${t.fg(label)}  ${t.comment(escapeTags(c.detail ?? ''))}`;
      }),
      `  ${t.comment('[n]')} ${t.fg('Cancel'.padEnd(labelW))}  ${t.comment('or Esc')}`,
    ];
  }
}
