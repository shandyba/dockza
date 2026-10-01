import blessed from 'neo-blessed';
import { C, t } from '@theme';
import { escapeTags, fitWidth, oneLine } from '@utils/format';
import { charWidth } from '@ui/widgets';

export interface CopyOption {
  /** The key that picks this option while the menu is open. */
  key: string;
  label: string;
  /** Raw text previewed next to the label (one line, truncated). */
  preview: string;
  /** What lands on the clipboard; `null` shows the option disabled. */
  text: string | null;
  /** Shown in place of the preview while disabled. */
  reason?: string;
  /** How the footer names what was copied, e.g. `value of PATH (48 chars)`. */
  subject: string;
}

export type PickedCopyOption = CopyOption & { text: string };

interface ShowOptions {
  options: CopyOption[];
  onPick: (option: PickedCopyOption) => void;
}

interface KeyEvent {
  full: string;
}

const MAX_WIDTH = 64;
/** Previews only need a screenful; a 128 KiB value is sampled before it is sanitised. */
const PREVIEW_SAMPLE = 512;

/**
 * "Copy to clipboard" popup: one row per option, picked by its key. Shared so any view can offer
 * its own options behind `y`.
 *
 * It owns the keyboard while open: `screen.grabKeys` mutes every `screen.key` handler (a tab's
 * `k` = kill must not fire underneath), so only this box's own `keypress` sees input.
 */
export class CopyMenu {
  private screen: blessed.Widgets.Screen;
  private box: blessed.Widgets.BoxElement;
  private visible = false;
  private options: CopyOption[] = [];
  private onPick: ((option: PickedCopyOption) => void) | null = null;

  private readonly handleKey = (_ch: unknown, key: KeyEvent) => {
    if (!this.visible) return;
    if (key.full === 'escape' || key.full === 'q' || key.full === 'C-c') {
      this.hide();
      return;
    }
    const option = this.options.find((o) => o.key === key.full);
    if (!option || option.text === null) return;
    const onPick = this.onPick;
    this.hide();
    onPick?.({ ...option, text: option.text });
  };

  // Focus moved elsewhere (a mouse click): treat it as a cancel so grabKeys can't strand the UI.
  // blessed also blurs an element it re-focuses (`next` is the element itself) — that is not leaving.
  private readonly handleBlur = (next?: unknown) => {
    if (this.visible && next !== this.box) this.hide();
  };

  constructor(screen: blessed.Widgets.Screen) {
    this.screen = screen;

    this.box = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: MAX_WIDTH,
      height: 8,
      tags: true,
      label: ' Copy to clipboard ',
      border: { type: 'line' },
      style: {
        bg: C.surface,
        border: { fg: C.purple },
        label: { fg: C.fg, bg: C.surface },
      },
      hidden: true,
    });

    this.box.on('keypress', this.handleKey);
    this.box.on('blur', this.handleBlur);
  }

  show({ options, onPick }: ShowOptions): void {
    this.options = options;
    this.onPick = onPick;

    const width = Math.max(30, Math.min(MAX_WIDTH, Number(this.screen.width) - 4));
    // Border (2) and the two-space margin on either side of every row.
    const inner = width - 2 - 4;
    const labelW = Math.max(...options.map((o) => o.label.length));

    const lines = [
      '',
      ...options.map((o) => this.row(o, labelW, inner)),
      '',
      `  ${t.dim('Esc')} ${t.comment('cancel')}`,
    ];

    this.box.width = width;
    this.box.height = lines.length + 2;
    this.box.setContent(lines.join('\n'));

    this.visible = true;
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
    this.onPick = null;
    this.screen.grabKeys = false;
    this.screen.restoreFocus();
    this.box.hide();
    this.screen.render();
  }

  isVisible(): boolean {
    return this.visible;
  }

  private row(o: CopyOption, labelW: number, inner: number): string {
    const enabled = o.text !== null;
    // key (1) + 2 spaces before the label, 2 spaces after it.
    const avail = Math.max(4, inner - 3 - labelW - 2);
    const source = enabled ? o.preview : (o.reason ?? '');
    const preview = fitWidth(oneLine(source.slice(0, PREVIEW_SAMPLE)), avail, charWidth).text;
    const label = escapeTags(o.label.padEnd(labelW));

    if (!enabled) return `  ${t.faint(o.key)}  ${t.faint(label)}  ${t.faint(escapeTags(preview))}`;
    return `  ${t.aqua(o.key)}  ${t.fg(label)}  ${t.comment(escapeTags(preview))}`;
  }
}
