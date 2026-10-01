import blessed from 'neo-blessed';
import { t } from '@theme';
import { escapeTags, textWidth } from '@utils/format';
import { charWidth, moveListCursor } from '@ui/widgets';

interface KeyEvent {
  name?: string;
  full: string;
  ctrl?: boolean;
  meta?: boolean;
}

type ChangeHandler = (query: string) => void;
type StateHandler = () => void;

/** Typed text, never a key chord or a control character (Tab, Backspace, an escape sequence). */
const isPrintable = (ch: unknown, key: KeyEvent): ch is string =>
  typeof ch === 'string' && ch !== '' && !/\p{Cc}/u.test(ch) && !key.ctrl && !key.meta;

/**
 * Filter-as-you-type for a list, drawn into the list frame's bottom border: `/ query▏ … N of M`.
 *
 * `/` on the list opens it. While open it owns the keyboard (`screen.grabKeys`, like the copy menu
 * and help), so letters go into the query instead of firing a view's `d` or `k`. Every edit emits
 * `change`, and the tab re-filters at once. The navigation keys still move the list's cursor, so
 * the matches can be walked while typing. Enter keeps the filter and hands the keys back to the
 * list; Esc clears it, both while typing and on the list.
 *
 * Its keys are bound on the list, not the screen: the list has the focus only when no panel,
 * dialog or overlay is up, so nothing needs guarding, and nothing is left to `removeKey` on hide.
 */
export class FilterBar {
  private readonly queryBox: blessed.Widgets.BoxElement;
  private readonly countBox: blessed.Widgets.BoxElement;
  private text = '';
  private editing = false;
  private count: { shown: number; total: number } | null = null;
  private changeHandlers: ChangeHandler[] = [];
  private stateHandlers: StateHandler[] = [];

  private readonly handleKey = (ch: unknown, key: KeyEvent) => {
    if (!this.editing) return;
    switch (key.full) {
      case 'enter':
        this.stop();
        this.list.focus();
        this.screen.render();
        return;
      case 'escape':
      case 'C-c':
        this.clear();
        this.list.focus();
        this.screen.render();
        return;
      case 'backspace':
        this.edit(Array.from(this.text).slice(0, -1).join(''));
        return;
      case 'C-u':
        this.edit('');
        return;
      case 'C-w':
        this.edit(this.text.replace(/\S*\s*$/, ''));
        return;
    }
    if (moveListCursor(this.list, key.full)) {
      this.screen.render();
      return;
    }
    if (isPrintable(ch, key)) this.edit(this.text + ch);
  };

  // Focus moved elsewhere (a mouse click): keep the query, so grabKeys can't strand the keyboard.
  // blessed also blurs an element it re-focuses (`next` is the element itself) — that is not leaving.
  private readonly handleBlur = (next?: unknown) => {
    if (this.editing && next !== this.queryBox) this.stop();
  };

  constructor(
    private readonly screen: blessed.Widgets.Screen,
    private readonly list: blessed.Widgets.ListElement,
  ) {
    // Siblings appended after the list, so they draw over its bottom border.
    const parent = list.parent as blessed.Widgets.BoxElement;
    this.queryBox = blessed.box({
      parent,
      bottom: 0,
      left: 1,
      width: 1,
      height: 1,
      tags: true,
      hidden: true,
    });
    this.countBox = blessed.box({
      parent,
      bottom: 0,
      right: 1,
      width: 1,
      height: 1,
      tags: true,
      hidden: true,
    });

    this.queryBox.on('keypress', this.handleKey);
    this.queryBox.on('blur', this.handleBlur);

    list.key(['/'], () => this.open());
    list.key(['escape'], () => {
      if (this.isActive()) {
        this.clear();
        this.screen.render();
      }
    });
    list.on('resize', () => this.draw());
  }

  on(event: 'change', handler: ChangeHandler): void;
  on(event: 'state', handler: StateHandler): void;
  on(event: 'change' | 'state', handler: ChangeHandler | StateHandler): void {
    if (event === 'change') this.changeHandlers.push(handler as ChangeHandler);
    if (event === 'state') this.stateHandlers.push(handler as StateHandler);
  }

  /** The query as typed; matching trims it. */
  query(): string {
    return this.text;
  }

  /** The input is open and holds the keyboard. */
  isEditing(): boolean {
    return this.editing;
  }

  /** Rows are being filtered out. */
  isActive(): boolean {
    return this.text.trim() !== '';
  }

  setCount(shown: number, total: number): void {
    this.count = { shown, total };
    this.draw();
  }

  open(): void {
    if (this.editing) return;
    this.editing = true;
    this.screen.grabKeys = true;
    this.draw();
    this.queryBox.focus();
    this.emitState();
    this.screen.render();
  }

  /** Closes the input and keeps the query. Safe to call when closed. */
  stop(): void {
    if (!this.editing) return;
    this.release();
    this.draw();
    this.emitState();
  }

  /** Empties the query and closes the input. */
  clear(): void {
    if (!this.editing && this.text === '') return;
    const had = this.text !== '';
    this.text = '';
    if (this.editing) this.release();
    this.draw();
    if (had) this.changeHandlers.forEach((h) => h(''));
    this.emitState();
  }

  private release(): void {
    this.editing = false;
    this.screen.grabKeys = false;
  }

  private edit(text: string): void {
    if (text === this.text) return;
    this.text = text;
    this.draw();
    this.changeHandlers.forEach((h) => h(text));
    this.screen.render();
  }

  private emitState(): void {
    this.stateHandlers.forEach((h) => h());
  }

  private draw(): void {
    if (!this.editing && this.text === '') {
      this.queryBox.hide();
      this.countBox.hide();
      return;
    }

    const count = this.isActive() && this.count ? ` ${this.count.shown} of ${this.count.total} ` : '';
    if (count) {
      this.countBox.setContent(t.dim(count));
      this.countBox.width = count.length;
      this.countBox.show();
    } else {
      this.countBox.hide();
    }

    // ` / ` before the query, the cursor and a space after it; two columns of rule before the count.
    const chrome = 3 + (this.editing ? 1 : 0) + 1;
    const room = Math.max(1, Number(this.list.width) - 4 - count.length - chrome);
    const shown = tail(this.text, room);
    const cursor = this.editing ? '{inverse} {/inverse}' : '';
    this.queryBox.setContent(` ${t.accent('/')} ${t.fg(escapeTags(shown))}${cursor} `);
    this.queryBox.width = chrome + textWidth(shown, charWidth);
    this.queryBox.show();
  }
}

/** The end of `s` that fits in `width` columns, led by `…` when it had to cut. */
function tail(s: string, width: number): string {
  if (textWidth(s, charWidth) <= width) return s;
  const chars = Array.from(s);
  while (chars.length > 0 && textWidth(chars.join(''), charWidth) > width - 1) chars.shift();
  return `…${chars.join('')}`;
}
