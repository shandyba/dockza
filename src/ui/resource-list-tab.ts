import blessed from 'neo-blessed';
import type { Location, PanelFocus, ResourceKind, ResourceRef, ViewId } from '@models/nav';
import { ConfirmDialog } from '@ui/containers/confirm-dialog';
import { FilterBar } from '@ui/filter-bar';
import { filteredHints, type FooterContext, type FooterHints, type Hint } from '@ui/footer';
import type { TabNav, ViewTab } from '@ui/view-tab';
import { t } from '@theme';
import { filterItems, type FilterFields } from '@utils/filter';
import { escapeTags, padEnd, truncate } from '@utils/format';
import {
  createCenteredMessage,
  createHeaderBar,
  createListWidget,
  listSelected,
  type Dims,
  type RunMutation,
} from '@ui/widgets';

type Handler = () => void;
type MessageHandler = (message: string) => void;

export interface ResourceColumn<T> {
  /** Header label; truncated to the column width so it can never overflow. */
  header: string;
  /** Fraction of the inner width; the final column absorbs the remainder. */
  weight: number;
  /** Colored cell content, already truncated to fit `width` (the base pads it). */
  render: (item: T, width: number) => string;
}

/** A detail panel over the list, as the tab drives it. `ContainerDetail`'s shape, keyed by `getKey`. */
export interface ResourceDetail<T> {
  readonly box: blessed.Widgets.BoxElement;
  show(item: T): void;
  update(item: T): void;
  /** Safe to call when hidden. */
  hide(): void;
  isVisible(): boolean;
  focusedSection(): string | null;
  focusedHints(): Hint[] | null;
  getFocus(): PanelFocus | undefined;
  setFocus(focus: PanelFocus | undefined): void;
  on(event: 'close-request', handler: Handler): void;
  on(event: 'section', handler: (section: string | null) => void): void;
  on(event: 'goto', handler: (ref: ResourceRef) => void): void;
  on(event: 'info' | 'error', handler: MessageHandler): void;
}

export interface ResourceDetailConfig<T> {
  /** What links to these rows point at. A ref's `id` is the row's `getKey`. */
  kind: ResourceKind;
  /** Human name for messages, when the key isn't one (an image ID, say). */
  label?: (item: T) => string;
  create: (screen: blessed.Widgets.Screen, dims: Dims) => ResourceDetail<T>;
  /** Footer hints while the panel is open with no section selected; a selected one brings its own. */
  footer: FooterContext;
}

export interface ResourceListConfig<T> {
  view: ViewId;
  /** Footer hints over the list. */
  footer: FooterContext;
  remove: (item: T) => Promise<void>;
  /** Stable key used to preserve the selection across refreshes. */
  getKey: (item: T) => string;
  /** Shown centered when the list is empty (e.g. `No networks`). */
  emptyMessage: string;
  confirmTitle: string;
  confirmLabel: (item: T) => string;
  /** Ordered guards; the first non-null message blocks deletion and is emitted. */
  guards: Array<(item: T) => string | null>;
  columns: ResourceColumn<T>[];
  /** The text `/` matches a row on. */
  filterFields: (item: T) => FilterFields;
  /** ↵ opens this panel on the selected row, and links to the row's kind land in it. */
  detail?: ResourceDetailConfig<T>;
}

/**
 * Shared machinery for the flat "resource list" tabs (Images / Volumes / Networks):
 * a header bar over a bordered list, `d`-to-delete with a confirm dialog and guards,
 * selection preservation across polls, `/` to filter, an optional detail panel, and the `ViewTab`
 * contract.
 * Concrete tabs supply only their columns, guards, confirm strings, remove function and
 * detail via config.
 *
 * The tab never fetches: App owns the listings and pushes them in via `setData`, and
 * deletions go through the injected `runMutation` so an in-flight poll can't resurrect
 * the removed row. Opening and closing the detail go through `nav`, so they're history steps.
 */
export class ResourceListTab<T> implements ViewTab {
  readonly view: ViewId;
  private screen: blessed.Widgets.Screen;
  private wrapper: blessed.Widgets.BoxElement;
  private headerBox: blessed.Widgets.BoxElement;
  readonly list: blessed.Widgets.ListElement;
  private messageBox: blessed.Widgets.BoxElement;
  private confirmDialog: ConfirmDialog;
  private filterBar: FilterBar;
  private detail: ResourceDetail<T> | null = null;
  /** Key of the item the detail shows. */
  private detailKey: string | null = null;

  /** Everything App pushed; `shown` is what the filter lets through, row for row with the list. */
  private items: T[] = [];
  private shown: T[] = [];
  private active = false;
  private updating = false;
  private contextHandlers: Handler[] = [];
  private errorHandlers: MessageHandler[] = [];
  private infoHandlers: MessageHandler[] = [];

  private readonly handleEnter = () => {
    // Screen keys fire before the focused panel's own: with the detail up, ↵ is the panel's.
    if (!this.active || this.isOverlayOpen() || !this.config.detail) return;
    const item = this.selected();
    if (item) this.nav.open({ kind: 'detail', ref: this.refOf(item) });
  };

  private readonly handleD = () => {
    if (!this.active || this.confirmDialog.isVisible()) return;
    const item = this.detail?.isVisible() ? this.shownItem() : this.selected();
    if (!item) return;

    for (const guard of this.config.guards) {
      const msg = guard(item);
      if (msg) {
        this.emitError(msg);
        return;
      }
    }

    if (this.detail?.isVisible()) this.nav.open(null);

    this.confirmDialog.show({
      title: this.config.confirmTitle,
      message: `${this.config.confirmLabel(item)} will be permanently deleted.`,
      danger: true,
      onConfirm: () => {
        void this.runMutation(() => this.config.remove(item))
          .catch((err: unknown) => this.emitError(err))
          .finally(() => {
            this.list.focus();
            this.screen.render();
          });
      },
      onCancel: () => {
        this.list.focus();
        this.screen.render();
      },
    });
  };

  constructor(
    screen: blessed.Widgets.Screen,
    dims: Dims,
    private readonly config: ResourceListConfig<T>,
    private readonly runMutation: RunMutation,
    private readonly nav: TabNav,
  ) {
    this.screen = screen;
    this.view = config.view;

    this.wrapper = blessed.box({
      parent: screen,
      top: dims.top,
      left: dims.left,
      width: dims.width,
      height: dims.height,
      hidden: true,
    });

    this.headerBox = createHeaderBar(this.wrapper);
    this.list = createListWidget(this.wrapper);
    this.messageBox = createCenteredMessage(this.wrapper);

    this.list.on('select item', () => {
      if (!this.updating) this.emitContext();
    });

    this.confirmDialog = new ConfirmDialog(screen);

    this.filterBar = new FilterBar(screen, this.list);
    this.filterBar.on('change', () => {
      this.render({ toTop: true });
      this.emitContext();
    });
    this.filterBar.on('state', () => this.emitContext());

    if (config.detail) {
      const detail = config.detail.create(screen, dims);
      detail.on('close-request', () => this.nav.open(null));
      detail.on('goto', (ref) => this.nav.follow(ref));
      detail.on('section', () => this.emitContext());
      detail.on('info', (msg) => this.infoHandlers.forEach((h) => h(msg)));
      detail.on('error', (msg) => this.emitError(msg));
      this.detail = detail;
    }
  }

  on(event: 'context', handler: Handler): void;
  on(event: 'error' | 'info', handler: MessageHandler): void;
  on(event: 'context' | 'error' | 'info', handler: Handler | MessageHandler): void {
    if (event === 'context') this.contextHandlers.push(handler as Handler);
    if (event === 'error') this.errorHandlers.push(handler as MessageHandler);
    if (event === 'info') this.infoHandlers.push(handler as MessageHandler);
  }

  isOverlayOpen(): boolean {
    return this.isInert() || (this.detail?.isVisible() ?? false);
  }

  isInert(): boolean {
    return this.confirmDialog.isVisible() || this.filterBar.isEditing();
  }

  showLoading(): void {
    this.messageBox.setContent(t.comment('  Loading...'));
    this.messageBox.show();
  }

  show(): void {
    if (this.active) return;
    this.active = true;
    this.wrapper.show();
    this.list.focus();
    this.screen.key(['enter'], this.handleEnter);
    this.screen.key(['d'], this.handleD);
    this.emitContext();
  }

  hide(): void {
    if (!this.active) return;
    this.active = false;
    this.detail?.hide();
    this.filterBar.stop();
    this.wrapper.hide();
    this.confirmDialog.hide();
    this.screen.removeKey('enter', this.handleEnter);
    this.screen.removeKey('d', this.handleD);
  }

  location(): Location {
    const item = this.selected();
    const loc: Location = { view: this.view, ...(item ? { selection: this.config.getKey(item) } : {}) };
    const shown = this.detail?.isVisible() ? this.shownItem() : undefined;
    if (!shown || !this.detail) return loc;
    const focus = this.detail.getFocus();
    const ref = this.refOf(shown);
    return { ...loc, panel: focus ? { kind: 'detail', ref, focus } : { kind: 'detail', ref } };
  }

  restore(loc: Location): boolean {
    const panel = loc.panel;
    const key = panel?.ref.id ?? loc.selection;
    if (key !== undefined) this.selectKey(key);

    const target = panel ? this.items.find((i) => this.config.getKey(i) === panel.ref.id) : undefined;
    if (!panel || !target) {
      this.closeDetail();
      return !panel;
    }
    // No detail here: a link lands on its row, which is now selected.
    if (this.detail && panel.kind === 'detail') {
      if (this.detailKey !== panel.ref.id || !this.detail.isVisible()) this.detail.show(target);
      this.detailKey = panel.ref.id;
      this.detail.setFocus(panel.focus);
    }
    this.emitContext();
    this.screen.render();
    return true;
  }

  has(ref: ResourceRef): boolean {
    return ref.kind === this.config.detail?.kind && this.items.some((i) => this.config.getKey(i) === ref.id);
  }

  footerContext(): FooterHints {
    if (this.filterBar.isEditing()) return 'filter';
    if (this.detail?.isVisible()) return this.detail.focusedHints() ?? this.config.detail!.footer;
    return this.filterBar.isActive() ? filteredHints(this.config.footer) : this.config.footer;
  }

  setData(items: T[]): void {
    this.items = items;
    this.render({ toTop: false });

    if (this.detail?.isVisible()) {
      const shown = this.shownItem();
      if (shown) this.detail.update(shown);
      else {
        // Gone under the panel: close it directly. Not a step the user took, so no history entry.
        this.detail.hide();
        this.list.focus();
      }
    }

    this.emitContext();
  }

  /** Re-render the current dataset (useful after terminal resize). */
  redraw(): void {
    this.setData(this.items);
  }

  /**
   * The rows the filter lets through, keeping the selected one where it still shows. Otherwise the
   * cursor goes to the top on a new query (`toTop`), or stays at its index when a poll removed it.
   */
  private render({ toTop }: { toTop: boolean }): void {
    this.updating = true;

    const prevIdx = listSelected(this.list);
    const prev = this.shown[prevIdx];
    const prevKey = prev ? this.config.getKey(prev) : undefined;

    const query = this.filterBar.query();
    this.shown = filterItems(this.items, query, this.config.filterFields);
    this.messageBox.hide();

    const innerWidth = Math.max(10, (this.list.width as number) - 2);
    const widths = this.calcWidths(innerWidth);

    this.renderHeader(widths);

    const rows = this.shown.map((item) => this.buildRow(item, widths));
    this.list.setItems(rows as unknown as blessed.Widgets.BlessedElement[]);

    const foundIdx = prevKey !== undefined ? this.indexOf(prevKey) : -1;
    const fallback = toTop ? 0 : prevIdx;
    this.list.select(Math.min(foundIdx >= 0 ? foundIdx : fallback, Math.max(0, this.shown.length - 1)));

    this.updating = false;

    if (this.shown.length === 0) {
      const msg =
        this.items.length === 0
          ? this.config.emptyMessage
          : `No matches for ${t.fg(escapeTags(query.trim()))}`;
      this.messageBox.setContent(t.comment(`  ${msg}`));
      this.messageBox.show();
    }

    this.filterBar.setCount(this.shown.length, this.items.length);
  }

  private indexOf(key: string): number {
    return this.shown.findIndex((i) => this.config.getKey(i) === key);
  }

  private selected(): T | undefined {
    return this.shown[listSelected(this.list)];
  }

  private shownItem(): T | undefined {
    return this.items.find((i) => this.config.getKey(i) === this.detailKey);
  }

  private refOf(item: T): ResourceRef {
    const detail = this.config.detail!;
    const label = detail.label?.(item);
    const ref: ResourceRef = { kind: detail.kind, id: this.config.getKey(item) };
    return label ? { ...ref, label } : ref;
  }

  /** A row the filter hides is still where history or a link points: the filter makes way. */
  private selectKey(key: string): void {
    if (this.indexOf(key) < 0 && this.items.some((i) => this.config.getKey(i) === key)) {
      this.filterBar.clear();
    }
    const idx = this.indexOf(key);
    if (idx >= 0) this.list.select(idx);
  }

  private closeDetail(): void {
    if (this.detail?.isVisible()) {
      this.detail.hide();
      this.list.focus();
    }
    this.emitContext();
    this.screen.render();
  }

  private emitContext(): void {
    this.contextHandlers.forEach((h) => h());
  }

  private emitError(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    this.errorHandlers.forEach((h) => h(msg));
  }

  private calcWidths(inner: number): number[] {
    const cols = this.config.columns;
    const widths: number[] = [];
    let used = 0;
    for (let i = 0; i < cols.length; i++) {
      if (i === cols.length - 1) {
        widths.push(Math.max(1, inner - used));
      } else {
        const w = Math.floor(inner * cols[i].weight);
        widths.push(w);
        used += w;
      }
    }
    return widths;
  }

  private renderHeader(widths: number[]): void {
    const cols = this.config.columns;
    const parts = cols.map((col, i) => {
      const w = widths[i];
      // First column carries a leading space and pads to w+1 (the list body indents
      // its rows by one), matching the data offset below.
      if (i === 0) return padEnd(t.comment(` ${truncate(col.header, w - 1)}`), w + 1);
      if (i === cols.length - 1) return t.comment(truncate(col.header, w));
      return padEnd(t.comment(truncate(col.header, w)), w);
    });
    this.headerBox.setContent(parts.join(''));
  }

  private buildRow(item: T, widths: number[]): string {
    return this.config.columns.map((col, i) => padEnd(col.render(item, widths[i]), widths[i])).join('');
  }
}
