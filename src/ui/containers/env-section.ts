import { C, t } from '@theme';
import { type EnvVar, formatEnvAll, parseEnv } from '@utils/env-vars';
import {
  type CharWidth,
  displaySafe,
  escapeTags,
  fitWidth,
  oneLine,
  textWidth,
  wrapLine,
} from '@utils/format';
import { shortSubject as short, type CopyOption } from '@ui/copy-menu';
import type { PanelSection, SectionKeyResult, SectionRender } from '@ui/detail/panel-section';
import type { Hint } from '@ui/footer';

/** ` ▸ ` in front of every row: space, caret, space. */
const GUTTER = 3;
/** Extra indent on an expanded value's continuation lines, so they read as part of the row above. */
const HANG = 2;
const NO_SELECTION = 'select a variable first — press e';

interface Piece {
  text: string;
  /** Code points into the entry's `NAME=…` line; `null` on lines after a newline in the value. */
  offset: number | null;
}

const plural = (n: number, word: string): string =>
  `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
const chars = (s: string): string => plural([...s].length, 'char');

/**
 * State and rendering of the detail panel's ENV section: shown / hidden, which variable is
 * selected, and which values are expanded to full length. Renders to tagged lines; the panel
 * owns scrolling and the cursor's travel. Every displayed byte goes through `displaySafe` +
 * `escapeTags`.
 *
 * Shown and focused are separate: ENV stays open when the cursor moves on (Tab), and only `e`
 * hides it again. Values can be secrets, which is why it starts hidden.
 */
export class EnvSection implements PanelSection {
  readonly id = 'env';
  private vars: EnvVar[] = [];
  private open = false;
  private index = 0;
  private expanded = new Set<string>();
  /** Expanded entries' wrapped lines: a 128 KiB value isn't re-wrapped on every stats render. */
  private wrapCache = new Map<string, { cols: number; pieces: Piece[] }>();

  constructor(private readonly charWidth?: CharWidth) {}

  /** A different container: start hidden, at the top, nothing expanded. */
  reset(env: string[]): void {
    this.vars = parseEnv(env);
    this.open = false;
    this.index = 0;
    this.expanded.clear();
    this.wrapCache.clear();
  }

  /** Same container, fresh poll: keep the selection on the same variable even if the order moved. */
  setVars(env: string[]): void {
    const selected = this.vars[this.index]?.name;
    this.vars = parseEnv(env);

    const found = selected === undefined ? -1 : this.vars.findIndex((v) => v.name === selected);
    this.index = found >= 0 ? found : Math.min(this.index, Math.max(0, this.vars.length - 1));

    const names = new Set(this.vars.map((v) => v.name));
    for (const name of this.expanded) if (!names.has(name)) this.expanded.delete(name);
    const raws = new Set(this.vars.map((v) => v.raw));
    for (const raw of this.wrapCache.keys()) if (!raws.has(raw)) this.wrapCache.delete(raw);
  }

  count(): number {
    return this.vars.length;
  }

  isOpen(): boolean {
    return this.open;
  }

  /** Shown with something to select: the arrow keys drive the selection instead of scrolling. */
  isNavigable(): boolean {
    return this.open && this.vars.length > 0;
  }

  /** Show / hide. With no variables there is nothing to show, so it stays hidden. */
  toggleOpen(): boolean {
    if (this.vars.length === 0) return false;
    this.open = !this.open;
    return true;
  }

  close(): void {
    this.open = false;
  }

  focusable(): boolean {
    return this.vars.length > 0;
  }

  /** The cursor can't sit on hidden rows: arriving shows them. */
  onFocus(): void {
    if (this.vars.length > 0) this.open = true;
  }

  rowKey(): string | undefined {
    return this.vars[this.index]?.name;
  }

  selectRow(name: string): boolean {
    const found = this.vars.findIndex((v) => v.name === name);
    if (found < 0) return false;
    this.index = found;
    return true;
  }

  onKey(key: string): SectionKeyResult {
    switch (key) {
      // `enter` only: blessed follows it with a `return` for the same key press.
      case 'enter':
        this.toggleValue();
        return 'changed';
      case 'right':
        this.expandValue();
        return 'changed';
      case 'left':
        this.collapseValue();
        return 'changed';
      case 'S-e':
        this.toggleAllValues();
        return 'changed';
      default:
        return 'ignored';
    }
  }

  active(): EnvVar | null {
    return this.isNavigable() ? (this.vars[this.index] ?? null) : null;
  }

  move(delta: number): void {
    this.index = Math.min(Math.max(0, this.index + delta), Math.max(0, this.vars.length - 1));
  }

  first(): void {
    this.index = 0;
  }

  last(): void {
    this.index = Math.max(0, this.vars.length - 1);
  }

  atFirst(): boolean {
    return this.index <= 0;
  }

  atLast(): boolean {
    return this.index >= this.vars.length - 1;
  }

  toggleValue(): void {
    const v = this.active();
    if (!v) return;
    if (this.expanded.has(v.name)) this.expanded.delete(v.name);
    else this.expanded.add(v.name);
  }

  expandValue(): void {
    const v = this.active();
    if (v) this.expanded.add(v.name);
  }

  collapseValue(): void {
    const v = this.active();
    if (v) this.expanded.delete(v.name);
  }

  /** Expand every value, or collapse them all when every one is already expanded. */
  toggleAllValues(): void {
    if (this.vars.length === 0) return;
    if (this.vars.every((v) => this.expanded.has(v.name))) this.expanded.clear();
    else for (const v of this.vars) this.expanded.add(v.name);
  }

  /** `cols`: the widest a line may be. Keep it below the box's inner width (see DetailPanel). */
  render(cols: number, focused: boolean): SectionRender {
    const lines = [this.header(focused)];
    if (!this.isNavigable()) return { lines, activeRange: null };

    let activeRange: [number, number] | null = null;
    this.vars.forEach((v, i) => {
      const active = focused && i === this.index;
      const start = lines.length;
      lines.push(...this.renderVar(v, active, cols));
      if (active) activeRange = [i === 0 ? 0 : start, lines.length - 1];
    });
    return { lines, activeRange };
  }

  footerHints(): Hint[] {
    return [
      { key: '↑↓', verb: 'select' },
      { key: '↵', verb: 'value' },
      { key: 'E', verb: 'all' },
      { key: 'y', verb: 'copy' },
      { key: 'Tab', verb: 'next' },
      { key: 'e', verb: 'hide' },
      { key: 'Esc', verb: 'close' },
    ];
  }

  /** The copy menu's options, captured now so a poll landing while it is open can't change them. */
  copyOptions(): CopyOption[] {
    const v = this.active();
    const n = this.vars.length;
    const all = formatEnvAll(this.vars);

    return [
      {
        key: 'n',
        label: 'name',
        preview: v?.name ?? '',
        text: v ? v.name : null,
        reason: NO_SELECTION,
        subject: v ? `name ${short(v.name)}` : '',
      },
      {
        key: 'v',
        label: 'value',
        preview: v?.value ?? '',
        text: v && v.hasValue && v.value !== '' ? v.value : null,
        reason: !v ? NO_SELECTION : v.hasValue ? '(empty)' : '(no value)',
        subject: v ? `value of ${short(v.name)} (${chars(v.value)})` : '',
      },
      {
        key: 'y',
        label: 'NAME=value',
        preview: v?.raw ?? '',
        text: v ? v.raw : null,
        reason: NO_SELECTION,
        subject: v ? `${short(v.raw)} (${chars(v.raw)})` : '',
      },
      {
        key: 'a',
        label: `all (${n})`,
        preview: 'NAME=value, one per line',
        text: n > 0 ? all : null,
        reason: 'no variables',
        subject: `all ${plural(n, 'variable')} (${chars(all)})`,
      },
    ];
  }

  private header(focused: boolean): string {
    const n = this.vars.length;
    if (n === 0) return `${t.comment('ENV (0)')}  ${t.faint('none')}`;
    if (!this.open) return `${t.comment(`ENV (${n}) ▸`)}  ${t.faint('Tab / e show')}`;
    if (!focused) return `${t.comment(`ENV (${n}) ▾`)}  ${t.faint('Tab / e select')}`;
    return `${t.comment(`ENV (${n}) ▾`)}  ${t.faint('↑↓ select · ↵ value · y copy · e hide')}`;
  }

  private renderVar(v: EnvVar, active: boolean, cols: number): string[] {
    const avail = Math.max(1, cols - GUTTER);
    const name = oneLine(v.name);
    const head = v.hasValue ? `${name}=` : name;

    // A collapsed row only shows a screenful, so only that much of a long value gets sanitised.
    const sample = v.value.slice(0, avail * 4);
    const preview = fitWidth(head + oneLine(sample), avail, this.charWidth);
    const expandable = preview.truncated || sample.length < v.value.length || v.value.includes('\n');
    const expanded = expandable && this.expanded.has(v.name);
    const caret = !expandable ? ' ' : expanded ? '▾' : '▸';

    const pieces = expanded ? this.wrapEntry(v, head, cols) : [{ text: preview.text, offset: 0 }];
    const nameLen = [...name].length;

    return pieces.map((p, i) => {
      if (active) {
        const gutter = i === 0 ? ` ${caret} ` : ' '.repeat(GUTTER + HANG);
        return this.highlight(gutter + p.text, cols);
      }
      const gutter = i === 0 ? ` ${t.accent(caret)} ` : ' '.repeat(GUTTER + HANG);
      return gutter + this.paint(p, nameLen, v.hasValue);
    });
  }

  private wrapEntry(v: EnvVar, head: string, cols: number): Piece[] {
    const cached = this.wrapCache.get(v.raw);
    if (cached && cached.cols === cols) return cached.pieces;

    const firstWidth = Math.max(1, cols - GUTTER);
    const restWidth = Math.max(1, cols - GUTTER - HANG);
    const [line0, ...more] = displaySafe(v.value).split('\n');

    const pieces: Piece[] = [];
    let offset = 0;
    for (const text of wrapLine(head + line0, restWidth, this.charWidth, firstWidth)) {
      pieces.push({ text, offset });
      offset += [...text].length;
    }
    for (const line of more) {
      for (const text of wrapLine(line, restWidth, this.charWidth)) pieces.push({ text, offset: null });
    }

    this.wrapCache.set(v.raw, { cols, pieces });
    return pieces;
  }

  /** Name yellow, `=` faint, value plain — split wherever this piece crosses those boundaries. */
  private paint(p: Piece, nameLen: number, hasValue: boolean): string {
    if (p.offset === null) return t.fg(escapeTags(p.text));
    const cps = [...p.text];
    const clamp = (n: number) => Math.min(Math.max(0, n), cps.length);
    const nameEnd = clamp(nameLen - p.offset);
    const eqEnd = hasValue ? clamp(nameLen + 1 - p.offset) : nameEnd;

    const seg = (from: number, to: number, color: (s: string) => string): string =>
      to > from ? color(escapeTags(cps.slice(from, to).join(''))) : '';
    return seg(0, nameEnd, t.yellow) + seg(nameEnd, eqEnd, t.faint) + seg(eqEnd, cps.length, t.fg);
  }

  /** The selected entry: list-selection colors, padded so the bar spans the section. */
  private highlight(text: string, cols: number): string {
    const pad = Math.max(0, cols - textWidth(text, this.charWidth));
    return `{${C.bgSel}-bg}{${C.fg}-fg}${escapeTags(text)}${' '.repeat(pad)}{/}`;
  }
}
