import type { ResourceRef } from '@models/nav';
import { C, t } from '@theme';
import { type CharWidth, escapeTags, fitMiddle, fitWidth, oneLine, textWidth } from '@utils/format';
import type { CopyOption } from '@ui/copy-menu';
import type { PanelSection, SectionKeyResult, SectionRender } from '@ui/detail/panel-section';

/** The row gutter: room for nothing but the selection bar's start. Matches ENV's ` ▸ `. */
const GUTTER = 3;
const GAP = '  ';
/** A growing cell squeezed below this is cut no further: the line wraps instead. */
const MIN_GROW = 8;

export interface RefCell {
  /** Plain text: the section sanitises, fits and escapes it. */
  text: string;
  /** Takes a share of the room left after the fixed cells; fixed cells keep their widest value. */
  grow?: boolean;
  /** Where a value too long for its column gets cut. Paths read best cut in the middle. */
  cut?: 'end' | 'middle';
  /** Theme color helper (`t.yellow`, …). Ignored on the selected row. */
  color?: (s: string) => string;
  /** Styled as a link: this is what ↵ follows. */
  link?: boolean;
  /** A status dot before the cell, in this color (`(s) => colorByStatus(c, s)`). */
  dot?: (s: string) => string;
}

export interface RefSectionSpec<T> {
  /** Section id: footer context, history focus. */
  id: string;
  title: string;
  /** What ↵ does from a row with a reference, for the header hint (`open volume`). */
  follow: string;
  /** Shown after the title when there are no rows. */
  empty: string;
  /** Stable row key: keeps the selection on the same row across polls, and in history. */
  key: (row: T) => string;
  /** The row's cells, left to right, the same count on every row. */
  cells: (row: T) => RefCell[];
  /** Where ↵ goes from this row; `null`: nowhere. */
  ref: (row: T) => ResourceRef | null;
  /** Copy menu for the selected row; `rows` for an "all" option. */
  copy: (row: T, rows: T[]) => CopyOption[];
}

/** A link: underlined, in the accent color. The same everywhere a reference can be followed. */
export const linkStyle = (s: string): string => `{underline}${t.accent(s)}`;

/**
 * A panel section listing references — a container's MOUNTS, a volume's USED BY — one line per
 * row, cells aligned in columns. ↵ follows the selected row's reference; `y` copies its parts.
 * Blessed-free like `EnvSection`, and generic so NETWORKS, PORTS or an image's users fit the same
 * mould: a spec says what a row's cells are, where it points, and what can be copied.
 */
export class RefSection<T> implements PanelSection {
  readonly id: string;
  private rows: T[] = [];
  private index = 0;

  constructor(
    private readonly spec: RefSectionSpec<T>,
    private readonly charWidth?: CharWidth,
  ) {
    this.id = spec.id;
  }

  /** A different subject: first row selected. */
  reset(rows: T[]): void {
    this.rows = rows;
    this.index = 0;
  }

  /** Same subject, fresh poll: keep the selection on the same row even if the order moved. */
  setRows(rows: T[]): void {
    const selected = this.rowKey();
    this.rows = rows;
    if (selected === undefined || !this.selectRow(selected)) {
      this.index = Math.min(this.index, Math.max(0, rows.length - 1));
    }
  }

  count(): number {
    return this.rows.length;
  }

  selected(): T | null {
    return this.rows[this.index] ?? null;
  }

  focusable(): boolean {
    return this.rows.length > 0;
  }

  move(delta: number): void {
    this.index = Math.min(Math.max(0, this.index + delta), Math.max(0, this.rows.length - 1));
  }

  first(): void {
    this.index = 0;
  }

  last(): void {
    this.index = Math.max(0, this.rows.length - 1);
  }

  atFirst(): boolean {
    return this.index <= 0;
  }

  atLast(): boolean {
    return this.index >= this.rows.length - 1;
  }

  rowKey(): string | undefined {
    const row = this.selected();
    return row === null ? undefined : this.spec.key(row);
  }

  selectRow(key: string): boolean {
    const found = this.rows.findIndex((r) => this.spec.key(r) === key);
    if (found < 0) return false;
    this.index = found;
    return true;
  }

  onKey(key: string): SectionKeyResult {
    // `enter` only: blessed follows it with a `return` for the same key press.
    if (key !== 'enter') return 'ignored';
    const row = this.selected();
    const ref = row === null ? null : this.spec.ref(row);
    return ref ? { goto: ref } : 'ignored';
  }

  copyOptions(): CopyOption[] {
    const row = this.selected();
    return row === null ? [] : this.spec.copy(row, this.rows);
  }

  render(cols: number, focused: boolean): SectionRender {
    const lines = [this.header(focused)];
    if (this.rows.length === 0) return { lines, activeRange: null };

    const cells = this.rows.map((r) => this.spec.cells(r).map((c) => ({ ...c, text: oneLine(c.text) })));
    const widths = this.columnWidths(cells, cols - GUTTER);
    let activeRange: [number, number] | null = null;
    cells.forEach((row, i) => {
      const active = focused && i === this.index;
      if (active) activeRange = [i === 0 ? 0 : lines.length, lines.length];
      lines.push(this.renderRow(row, widths, active, this.spec.ref(this.rows[i]) !== null, cols));
    });
    return { lines, activeRange };
  }

  private header(focused: boolean): string {
    const title = t.comment(`${this.spec.title} (${this.rows.length})`);
    if (this.rows.length === 0) return `${title}  ${t.faint(this.spec.empty)}`;
    const follows = this.rows.some((r) => this.spec.ref(r) !== null);
    if (!focused) return `${title}  ${t.faint('Tab select')}`;
    const hint = ['↑↓ select', ...(follows ? [`↵ ${this.spec.follow}`] : []), 'y copy', 'Tab next'];
    return `${title}  ${t.faint(hint.join(' · '))}`;
  }

  /** Fixed cells keep their widest value; growing ones share what's left, by how much they need. */
  private columnWidths(rows: RefCell[][], avail: number): number[] {
    const n = rows[0]?.length ?? 0;
    const natural = Array.from({ length: n }, (_, c) =>
      Math.max(...rows.map((r) => textWidth(r[c].text, this.charWidth) + (r[c].dot ? 2 : 0))),
    );
    const grows = rows[0]?.map((c) => c.grow === true) ?? [];
    const fixed = natural.reduce((sum, w, c) => sum + (grows[c] ? 0 : w), 0);
    const room = avail - fixed - GAP.length * Math.max(0, n - 1);
    const wanted = natural.reduce((sum, w, c) => sum + (grows[c] ? w : 0), 0);
    if (wanted <= room) return natural;
    // Each growing column is guaranteed a little; what's left is shared by how much more each needs.
    const base = natural.map((w, c) => (grows[c] ? Math.min(w, MIN_GROW) : w));
    const spare = room - base.reduce((sum, w, c) => sum + (grows[c] ? w : 0), 0);
    if (spare <= 0) return base;
    const need = wanted - base.reduce((sum, w, c) => sum + (grows[c] ? w : 0), 0);
    return base.map((w, c) => (grows[c] ? w + Math.floor((spare * (natural[c] - w)) / need) : w));
  }

  private renderRow(
    row: RefCell[],
    widths: number[],
    active: boolean,
    follows: boolean,
    cols: number,
  ): string {
    const last = row.length - 1;
    const parts = row.map((cell, c) => {
      const room = widths[c] - (cell.dot ? 2 : 0);
      const fit = cell.cut === 'middle' ? fitMiddle : fitWidth;
      const text = fit(cell.text, room, this.charWidth).text;
      // The last cell isn't padded: trailing blanks would only push the highlight wider.
      const pad = c === last ? 0 : Math.max(0, room - textWidth(text, this.charWidth));
      return { cell, text, pad };
    });

    if (active) {
      // One color for the whole bar: a colored dot's closing tag would end the highlight early.
      const cellText = ({ cell, text, pad }: (typeof parts)[number]) =>
        `${cell.dot ? '● ' : ''}${text}${' '.repeat(pad)}`;
      const line = ' '.repeat(GUTTER) + parts.map(cellText).join(GAP);
      const fill = Math.max(0, cols - textWidth(line, this.charWidth));
      return `{${C.bgSel}-bg}{${C.fg}-fg}${escapeTags(line)}${' '.repeat(fill)}{/}`;
    }

    const body = parts
      .map(({ cell, text, pad }) => {
        const safe = escapeTags(text);
        const styled = cell.link && follows ? linkStyle(safe) : cell.color ? cell.color(safe) : t.fg(safe);
        return `${cell.dot ? `${cell.dot('●')} ` : ''}${styled}${' '.repeat(pad)}`;
      })
      .join(GAP);
    return ' '.repeat(GUTTER) + body;
  }
}
