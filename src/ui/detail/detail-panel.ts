import blessed from 'neo-blessed';
import type { PanelFocus, ResourceRef } from '@models/nav';
import { C } from '@theme';
import { copyToClipboard, describeCopy, type CopyResult } from '@utils/clipboard';
import { revealRange } from '@utils/viewport';
import { CopyMenu, type CopyOption, type PickedCopyOption } from '@ui/copy-menu';
import type { PanelSection } from '@ui/detail/panel-section';
import { createHeaderBar, type Dims } from '@ui/widgets';

/** Puts text on the clipboard. Injected so tests don't touch the real one. */
export type CopyFn = (text: string) => Promise<CopyResult>;

type Handler = () => void;
type SectionHandler = (section: string | null) => void;
type GotoHandler = (ref: ResourceRef) => void;
type MessageHandler = (message: string) => void;

interface KeyEvent {
  full: string;
}

/** What a panel shows. Closures over the owner's state, so the panel holds none of its own. */
export interface DetailContent {
  /** Header bar, tagged (escape anything untrusted). */
  header(): string;
  /** The body top to bottom: tagged lines, with each section where it goes. */
  blocks(): Array<string | PanelSection>;
  /** Sections in Tab order. */
  sections(): PanelSection[];
  /** The copy menu while no section has the cursor: the panel's own subject. */
  subjectCopy(): CopyOption[];
  /** The owner's own keys (ENV's `e`). True when handled, rendering included. */
  onKey?(key: string): boolean;
}

export function terminalCopy(screen: blessed.Widgets.Screen): CopyFn {
  return (text) =>
    copyToClipboard(text, {
      // Flush first so the sequence can't land in the middle of a buffered frame.
      writeTerminal: (seq) => {
        screen.program.flush();
        screen.program.write(seq);
      },
    });
}

/**
 * The scrollable panel a detail view lives in: header bar, body, the copy menu (`y`), and the
 * cursor's travel between sections (Tab / Shift+Tab, none → each section → none). With no section
 * focused the arrows scroll; with one, they move its selection and scroll past either end.
 *
 * Esc doesn't close the panel itself: it emits `close-request`, and the owner decides (the router
 * snapshots where the cursor was first, so going back can return to it).
 */
export class DetailPanel {
  private screen: blessed.Widgets.Screen;
  private wrapper: blessed.Widgets.BoxElement;
  private headerBox: blessed.Widgets.BoxElement;
  readonly box: blessed.Widgets.BoxElement;
  private copyMenu: CopyMenu;

  private visible = false;
  private focused: PanelSection | null = null;
  /** Last value sent to `section` listeners. */
  private sentSection: string | null = null;
  /** Content lines (before blessed wraps them) holding the cursor's row. */
  private activeLines: [number, number] | null = null;

  private closeHandlers: Handler[] = [];
  private sectionHandlers: SectionHandler[] = [];
  private gotoHandlers: GotoHandler[] = [];
  private infoHandlers: MessageHandler[] = [];
  private errorHandlers: MessageHandler[] = [];

  private readonly handleEscape = () => {
    if (this.visible) this.closeHandlers.forEach((h) => h());
  };

  /**
   * Every key but Esc. Bound to the box, not the screen, so it only acts while the panel has focus
   * (not under the help overlay) and goes quiet while the copy menu holds the keyboard.
   */
  private readonly handleKey = (_ch: unknown, key: KeyEvent) => {
    // `x` / `S` hide the panel without moving focus off it.
    if (!this.visible || this.copyMenu.isVisible()) return;
    switch (key.full) {
      case 'y':
        return this.openCopyMenu();
      case 'tab':
        return this.cycle(1);
      case 'S-tab':
        return this.cycle(-1);
    }
    if (this.content.onKey?.(key.full)) return;
    if (this.focused) this.sectionKey(this.focused, key.full);
    else this.scrollPanel(key.full);
  };

  private readonly handleResize = () => {
    if (this.visible) this.render();
  };

  constructor(
    screen: blessed.Widgets.Screen,
    dims: Dims,
    private readonly content: DetailContent,
    private readonly copy: CopyFn = terminalCopy(screen),
  ) {
    this.screen = screen;

    this.wrapper = blessed.box({
      parent: screen,
      top: dims.top,
      left: dims.left,
      width: dims.width,
      height: dims.height,
      style: { bg: C.bg },
      hidden: true,
    });

    this.headerBox = createHeaderBar(this.wrapper);

    // No `keys: true`: the arrows either scroll or move a section's selection, so `handleKey` owns them.
    this.box = blessed.box({
      parent: this.wrapper,
      top: 1,
      left: 0,
      height: '100%-1',
      width: '100%',
      scrollable: true,
      mouse: true,
      tags: true,
      alwaysScroll: true,
      scrollbar: { ch: '│', style: { fg: C.comment } },
      style: { fg: C.fg, bg: C.bg },
      padding: { left: 2, right: 2 },
    });

    this.copyMenu = new CopyMenu(screen);

    this.box.on('keypress', this.handleKey);
    screen.on('resize', this.handleResize);
  }

  on(event: 'close-request', handler: Handler): void;
  on(event: 'section', handler: SectionHandler): void;
  on(event: 'goto', handler: GotoHandler): void;
  on(event: 'info' | 'error', handler: MessageHandler): void;
  on(
    event: 'close-request' | 'section' | 'goto' | 'info' | 'error',
    handler: Handler | SectionHandler | GotoHandler | MessageHandler,
  ): void {
    if (event === 'close-request') this.closeHandlers.push(handler as Handler);
    if (event === 'section') this.sectionHandlers.push(handler as SectionHandler);
    if (event === 'goto') this.gotoHandlers.push(handler as GotoHandler);
    if (event === 'info') this.infoHandlers.push(handler as MessageHandler);
    if (event === 'error') this.errorHandlers.push(handler as MessageHandler);
  }

  /** Opens on a new subject: at the top, no section focused. The owner resets its sections first. */
  show(): void {
    const wasVisible = this.visible;
    this.visible = true;
    this.focused = null;
    this.sentSection = null;

    this.render();
    this.updateHeader();
    this.wrapper.show();
    this.box.focus();
    // A new subject starts at the top, not where the previous one was scrolled to.
    this.box.scrollTo(0);

    // Re-shown on another subject while open: Esc is bound already, and binding twice fires twice.
    if (!wasVisible) this.screen.key(['escape'], this.handleEscape);
    this.screen.render();
  }

  /**
   * Safe to call when already hidden. It must be: blessed's `removeListener` deletes a key's only
   * listener whichever handler it is given, so a stray removal would take another widget's Esc.
   */
  hide(): void {
    if (!this.visible) return;
    // First, so `grabKeys` is never left on by a poll that removes the subject mid-menu.
    this.copyMenu.hide();
    this.visible = false;
    this.focused = null;
    this.sentSection = null;
    this.wrapper.hide();

    this.screen.removeKey('escape', this.handleEscape);

    this.screen.render();
  }

  /** Same subject, fresh data. No reveal: a poll must not undo the user's own scrolling. */
  refresh(): void {
    if (!this.visible) return;
    if (this.focused && !this.focused.focusable()) this.focused = null;
    this.render();
    this.clampScroll();
    this.updateHeader();
    this.syncSection();
  }

  isVisible(): boolean {
    return this.visible;
  }

  focusedSection(): string | null {
    return this.focused?.id ?? null;
  }

  /** Puts the cursor on a section (`null`: none), revealing its selected row. */
  focus(id: string | null): void {
    const next = id === null ? null : (this.focusable().find((s) => s.id === id) ?? null);
    this.focused = next;
    next?.onFocus?.();
    this.render();
    if (next) this.reveal();
    this.clampScroll();
    this.syncSection();
    this.screen.render();
  }

  /** Where the cursor is, for history. */
  getFocus(): PanelFocus | undefined {
    if (!this.focused) return undefined;
    const row = this.focused.rowKey();
    return row === undefined ? { section: this.focused.id } : { section: this.focused.id, row };
  }

  /** Puts the cursor back where `getFocus` found it, as far as that row still exists. */
  setFocus(focus: PanelFocus | undefined): void {
    if (!focus) return;
    const section = this.focusable().find((s) => s.id === focus.section);
    if (!section) return;
    if (focus.row !== undefined) section.selectRow(focus.row);
    this.focus(section.id);
  }

  private focusable(): PanelSection[] {
    return this.content.sections().filter((s) => s.focusable());
  }

  private cycle(dir: 1 | -1): void {
    const stops: Array<PanelSection | null> = [null, ...this.focusable()];
    if (stops.length === 1) return;
    const at = Math.max(0, stops.indexOf(this.focused));
    const next = stops[(at + dir + stops.length) % stops.length];
    this.focus(next?.id ?? null);
  }

  private openCopyMenu(): void {
    const options = this.focused ? this.focused.copyOptions() : this.content.subjectCopy();
    if (options.length === 0) {
      this.infoHandlers.forEach((h) => h('Nothing to copy'));
      return;
    }
    this.copyMenu.show({ options, onPick: (o) => this.copyOption(o) });
  }

  private copyOption(option: PickedCopyOption): void {
    void this.copy(option.text)
      .then((result) => {
        const { text, color } = describeCopy(option.subject, result);
        const handlers = color === 'green' ? this.infoHandlers : this.errorHandlers;
        handlers.forEach((h) => h(text));
      })
      .catch((err: unknown) => {
        const msg = `Copy failed: ${err instanceof Error ? err.message : String(err)}`;
        this.errorHandlers.forEach((h) => h(msg));
      });
  }

  private sectionKey(section: PanelSection, key: string): void {
    switch (key) {
      case 'up':
        // Past the first row the panel itself scrolls on up, back to the summary at the top.
        if (section.atFirst()) return this.scrollPanel('home');
        section.move(-1);
        break;
      case 'down':
        if (section.atLast()) return this.scrollPanel('down');
        section.move(1);
        break;
      case 'pageup':
        section.move(-this.pageSize());
        break;
      case 'pagedown':
        section.move(this.pageSize());
        break;
      case 'home':
        section.first();
        break;
      case 'end':
        section.last();
        break;
      default: {
        const result = section.onKey(key);
        if (result === 'ignored') return;
        if (result !== 'changed') {
          // The owner navigates away; this panel is hidden by the time it returns.
          this.gotoHandlers.forEach((h) => h(result.goto));
          return;
        }
      }
    }
    this.render();
    this.reveal();
    this.clampScroll();
    this.screen.render();
  }

  private scrollPanel(key: string): void {
    switch (key) {
      case 'up':
        this.box.scroll(-1);
        break;
      case 'down':
        this.box.scroll(1);
        break;
      case 'pageup':
        this.box.scroll(-this.pageSize());
        break;
      case 'pagedown':
        this.box.scroll(this.pageSize());
        break;
      case 'home':
        this.box.scrollTo(0);
        break;
      case 'end':
        this.box.setScrollPerc(100);
        break;
      default:
        return;
    }
    this.clampScroll();
    this.screen.render();
  }

  private viewport(): number {
    return Math.max(1, Number(this.box.height) - Number(this.box.iheight));
  }

  private pageSize(): number {
    return Math.max(1, this.viewport() - 1);
  }

  /**
   * Scroll so the cursor's row is on screen. Content lines aren't screen rows — blessed wraps
   * anything wider than the box (a long path, say) — so map them through its wrap table.
   */
  private reveal(): void {
    if (!this.activeLines) return;
    const [first, last] = this.toRows(this.activeLines);
    this.box.scrollTo(revealRange(this.box.childBase, this.viewport(), first, last));
  }

  private toRows([start, end]: [number, number]): [number, number] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- `_clines` (blessed's wrapped lines) is untyped
    const ftor: number[][] | undefined = (this.box as any)._clines?.ftor;
    const first = ftor?.[start]?.[0] ?? start;
    const lastRows = ftor?.[end];
    const last = lastRows && lastRows.length > 0 ? lastRows[lastRows.length - 1] : end;
    return [first, last];
  }

  /** After content shrinks, pull the view back so the panel doesn't end in blank rows. */
  private clampScroll(): void {
    const max = Math.max(0, this.box.getScrollHeight() - this.viewport());
    if (this.box.childBase > max) this.box.scrollTo(max);
  }

  private syncSection(): void {
    const id = this.focused?.id ?? null;
    if (id === this.sentSection) return;
    this.sentSection = id;
    this.sectionHandlers.forEach((h) => h(id));
  }

  private updateHeader(): void {
    this.headerBox.setContent(this.content.header());
  }

  /** Widest a section line may be: blessed wraps at the inner width less the scrollbar column. */
  private cols(): number {
    return Math.max(10, Number(this.box.width) - Number(this.box.iwidth) - 1);
  }

  private render(): void {
    const cols = this.cols();
    const lines: string[] = [];
    this.activeLines = null;
    for (const block of this.content.blocks()) {
      if (typeof block === 'string') {
        lines.push(block);
        continue;
      }
      const start = lines.length;
      const out = block.render(cols, block === this.focused);
      lines.push(...out.lines);
      if (out.activeRange) this.activeLines = [start + out.activeRange[0], start + out.activeRange[1]];
    }
    this.box.setContent(lines.join('\n'));
  }
}
