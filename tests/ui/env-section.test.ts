import { describe, it, expect } from 'vitest';
import { EnvSection } from '@ui/containers/env-section';
import { stripTags } from '@utils/format';

const COLS = 40;
const LONG_PATH =
  'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/lib/postgresql/18/bin';

/** What the terminal shows: tags stripped, escaped braces restored. */
function plain(line: string): string {
  return stripTags(line.replace(/\{open\}/g, '\uE000').replace(/\{close\}/g, '\uE001'))
    .replace(/\uE000/g, '{')
    .replace(/\uE001/g, '}');
}

function shown(env: string[]): EnvSection {
  const s = new EnvSection();
  s.reset(env);
  s.toggleOpen();
  return s;
}

/** Rendered with the cursor on the section, as the detail panel does while ENV is focused. */
const render = (s: EnvSection) => s.render(COLS, true);
const rows = (s: EnvSection): string[] => render(s).lines.slice(1).map(plain);

describe('EnvSection visibility', () => {
  it('starts hidden with a one-line header', () => {
    const s = new EnvSection();
    s.reset(['A=1', 'B=2']);
    const r = render(s);
    expect(r.lines.map(plain)).toEqual(['ENV (2) ▸  Tab / e show']);
    expect(r.activeRange).toBeNull();
    expect(s.isNavigable()).toBe(false);
    expect(s.active()).toBeNull();
  });

  it('cannot be shown with no variables', () => {
    const s = new EnvSection();
    s.reset([]);
    expect(s.toggleOpen()).toBe(false);
    expect(s.isNavigable()).toBe(false);
    expect(render(s).lines.map(plain)).toEqual(['ENV (0)  none']);
  });

  it('shows every variable with the first one selected', () => {
    const s = shown(['A=1', 'B=2']);
    expect(s.isNavigable()).toBe(true);
    expect(s.active()?.name).toBe('A');
    expect(plain(render(s).lines[0])).toContain('ENV (2) ▾');
    expect(rows(s).map((r) => r.trim())).toEqual(['A=1', 'B=2']);
  });
});

describe('EnvSection selection', () => {
  it('moves within bounds', () => {
    const s = shown(['A=1', 'B=2', 'C=3']);
    s.move(-5);
    expect(s.active()?.name).toBe('A');
    expect(s.atFirst()).toBe(true);
    s.move(1);
    expect(s.active()?.name).toBe('B');
    s.move(10);
    expect(s.active()?.name).toBe('C');
    expect(s.atLast()).toBe(true);
    s.first();
    expect(s.active()?.name).toBe('A');
    s.last();
    expect(s.active()?.name).toBe('C');
  });

  it('highlights only the selected row, across the full width', () => {
    const s = shown(['A=1', 'B=2']);
    s.move(1);
    const [, a, b] = render(s).lines;
    expect(a).not.toContain('-bg}');
    expect(b).toContain('-bg}');
    expect(plain(b)).toHaveLength(COLS);
  });

  it('reports the selected rows, starting at the header for the first variable', () => {
    const s = shown(['A=1', 'B=2', 'C=3']);
    expect(render(s).activeRange).toEqual([0, 1]);
    s.move(2);
    expect(render(s).activeRange).toEqual([3, 3]);
  });

  it('keeps the same variable selected when a poll reorders the list', () => {
    const s = shown(['A=1', 'B=2', 'C=3']);
    s.move(1);
    s.setVars(['C=3', 'A=1', 'B=2']);
    expect(s.active()?.name).toBe('B');
  });

  it('keeps the position when the selected variable disappears', () => {
    const s = shown(['A=1', 'B=2', 'C=3']);
    s.last();
    s.setVars(['A=1', 'B=2']);
    expect(s.active()?.name).toBe('B');
    s.setVars([]);
    expect(s.isNavigable()).toBe(false);
  });

  it('starts over for a different container', () => {
    const s = shown(['A=1', 'B=2']);
    s.move(1);
    s.reset(['X=1']);
    expect(s.isOpen()).toBe(false);
    s.toggleOpen();
    expect(s.active()?.name).toBe('X');
  });
});

describe('EnvSection values', () => {
  it('truncates a long value with a ▸ caret, and short ones get no caret', () => {
    const s = shown(['TZ=Europe/Kyiv', LONG_PATH]);
    const [tz, path] = rows(s);
    expect(tz).toBe('   TZ=Europe/Kyiv'.padEnd(COLS));
    expect(path.startsWith(' ▸ PATH=/usr/local/sbin')).toBe(true);
    expect(path.trimEnd().endsWith('…')).toBe(true);
    expect(path.trimEnd().length).toBeLessThanOrEqual(COLS);
  });

  it('expands to the full value with a hanging indent, never wider than the columns', () => {
    const s = shown([LONG_PATH]);
    s.expandValue();
    const lines = rows(s).map((l) => l.trimEnd());
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0].startsWith(' ▾ PATH=')).toBe(true);
    for (const l of lines.slice(1)) expect(l.startsWith('     ')).toBe(true);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(COLS);
    expect(lines.map((l) => l.slice(l === lines[0] ? 3 : 5)).join('')).toBe(LONG_PATH);
  });

  it('shows a 128 KiB value in full', () => {
    const value = 'v'.repeat(131072);
    const s = shown([`BIG=${value}`]);
    s.toggleValue();
    const lines = rows(s).map((l) => l.trimEnd());
    expect(lines.map((l, i) => l.slice(i === 0 ? 3 : 5)).join('')).toBe(`BIG=${value}`);
  });

  it('collapses again with toggle and with collapse', () => {
    const s = shown([LONG_PATH]);
    s.toggleValue();
    expect(rows(s).length).toBeGreaterThan(1);
    s.toggleValue();
    expect(rows(s)).toHaveLength(1);
    s.expandValue();
    s.collapseValue();
    expect(rows(s)).toHaveLength(1);
  });

  it('treats a multi-line value as expandable and shows each line', () => {
    const s = shown(['CERT=line one\nline two']);
    expect(rows(s)[0].trimEnd()).toBe(' ▸ CERT=line one⏎line two');
    s.expandValue();
    expect(rows(s).map((l) => l.trimEnd())).toEqual([' ▾ CERT=line one', '     line two']);
  });

  it('expands every value, then collapses them all', () => {
    const s = shown([LONG_PATH, 'MULTI=a\nb', 'TZ=UTC']);
    s.toggleAllValues();
    expect(rows(s).length).toBeGreaterThan(4);
    s.toggleAllValues();
    expect(rows(s)).toHaveLength(3);
  });

  it('forgets the expansion of a variable that goes away', () => {
    const s = shown([LONG_PATH]);
    s.expandValue();
    s.setVars([]);
    s.setVars([LONG_PATH]);
    expect(rows(s)).toHaveLength(1);
  });

  it('escapes blessed tags and neutralises control characters in names and values', () => {
    const s = shown(['TAG={bold}x{/}', 'ESC=\x1b[2J']);
    s.move(1);
    const [tag, esc] = render(s).lines.slice(1);
    expect(tag).toContain('{open}bold{close}x{open}/{close}');
    expect(plain(tag).trim()).toBe('TAG={bold}x{/}');
    expect(esc).not.toContain('\x1b');
    expect(plain(esc).trim()).toBe('ESC=^[[2J');
  });

  it('colors name, separator and value separately on unselected rows', () => {
    const s = shown(['A=1', 'B=2']);
    const row = render(s).lines[2];
    expect(row).toMatch(/\{#f4c64a-fg\}B\{\/\}/);
    expect(row).toMatch(/\{#5a5853-fg\}=\{\/\}/);
  });
});

describe('EnvSection copy options', () => {
  const byKey = (s: EnvSection) => Object.fromEntries(s.copyOptions().map((o) => [o.key, o]));

  it('offers name, value, NAME=value and all for the selected variable', () => {
    const s = shown(['TZ=UTC', LONG_PATH]);
    s.move(1);
    const o = byKey(s);
    expect(o.n.text).toBe('PATH');
    expect(o.v.text).toBe(LONG_PATH.slice('PATH='.length));
    expect(o.y.text).toBe(LONG_PATH);
    expect(o.a.text).toBe(`TZ=UTC\n${LONG_PATH}`);
    expect(o.a.label).toBe('all (2)');
    expect(o.n.subject).toBe('name PATH');
    const valueLen = LONG_PATH.length - 'PATH='.length;
    expect(o.v.subject).toBe(`value of PATH (${valueLen} chars)`);
    expect(o.a.subject).toBe(`all 2 variables (${'TZ=UTC\n'.length + LONG_PATH.length} chars)`);
  });

  it('only offers "all" while nothing is selected', () => {
    const s = new EnvSection();
    s.reset(['A=1']);
    const o = byKey(s);
    expect(o.n.text).toBeNull();
    expect(o.v.text).toBeNull();
    expect(o.y.text).toBeNull();
    expect(o.n.reason).toMatch(/press e/);
    expect(o.a.text).toBe('A=1');
    expect(o.a.subject).toBe('all 1 variable (3 chars)');
  });

  it('disables copying an empty or missing value', () => {
    const s = shown(['EMPTY=', 'BARE']);
    expect(byKey(s).v).toMatchObject({ text: null, reason: '(empty)' });
    s.move(1);
    expect(byKey(s).v).toMatchObject({ text: null, reason: '(no value)' });
    expect(byKey(s).y.text).toBe('BARE');
  });
});

describe('EnvSection as a panel section', () => {
  it('stays open without the cursor: rows shown, nothing highlighted', () => {
    const s = shown(['A=1', 'B=2']);
    const r = s.render(COLS, false);
    expect(plain(r.lines[0])).toBe('ENV (2) ▾  Tab / e select');
    expect(r.lines.slice(1).map((l) => plain(l).trim())).toEqual(['A=1', 'B=2']);
    expect(r.lines.some((l) => l.includes('-bg}'))).toBe(false);
    expect(r.activeRange).toBeNull();
  });

  it('opens when the cursor arrives; focusable only with variables', () => {
    const s = new EnvSection();
    s.reset(['A=1']);
    expect(s.focusable()).toBe(true);
    s.onFocus();
    expect(s.isOpen()).toBe(true);
    s.close();
    expect(s.isOpen()).toBe(false);

    s.reset([]);
    expect(s.focusable()).toBe(false);
    s.onFocus();
    expect(s.isOpen()).toBe(false);
  });

  it('acts on the selected row: ↵ toggles, → / ← expand and collapse, E all', () => {
    const s = shown([LONG_PATH, 'B=2']);
    const collapsed = rows(s).length;
    expect(s.onKey('enter')).toBe('changed');
    expect(rows(s).length).toBeGreaterThan(collapsed);
    expect(s.onKey('left')).toBe('changed');
    expect(rows(s).length).toBe(collapsed);
    expect(s.onKey('right')).toBe('changed');
    expect(s.onKey('S-e')).toBe('changed');
    expect(s.onKey('return')).toBe('ignored'); // blessed's echo of the same Enter
    expect(s.onKey('x')).toBe('ignored');
  });

  it('names its selected row by variable, and selects it back', () => {
    const s = shown(['A=1', 'B=2', 'C=3']);
    s.move(2);
    expect(s.rowKey()).toBe('C');
    expect(s.selectRow('B')).toBe(true);
    expect(s.active()?.name).toBe('B');
    expect(s.selectRow('GONE')).toBe(false);
    expect(s.active()?.name).toBe('B');
  });
});
