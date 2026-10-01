import blessed from 'neo-blessed';
import { C } from '@theme';
import type { CharWidth } from '@utils/format';
type Parent = blessed.Widgets.Screen | blessed.Widgets.BoxElement;

/**
 * Columns blessed gives a code point under `fullUnicode` (CJK / emoji take 2). Text we pre-wrap
 * must be measured the same way or blessed re-wraps it and our line numbers drift.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- `unicode` is missing from @types/blessed
export const charWidth: CharWidth = (codePoint) => (blessed as any).unicode.charWidth(codePoint);

export interface Dims {
  top: number | string;
  left: number | string;
  width: number | string;
  height: number | string;
}

/** Runs a docker mutation and refetches the affected data before resolving. Supplied by App. */
export type RunMutation = (action: () => Promise<void>) => Promise<void>;

interface ListOptions {
  top?: number | string;
  left?: number | string;
  width?: number | string;
  height?: number | string;
}

export function listSelected(list: blessed.Widgets.ListElement): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (list as any).selected;
  return typeof raw === 'number' ? raw : 0;
}

/**
 * Moves a list's cursor for a navigation key, the way its own `keys` would (blessed's list has no
 * paging keys of its own). For a widget holding the keyboard over the list, like the filter.
 * False when `key` isn't a navigation key.
 */
export function moveListCursor(list: blessed.Widgets.ListElement, key: string): boolean {
  const page = Math.max(1, Number(list.height) - Number(list.iheight));
  const last = Math.max(0, (list as unknown as { items: unknown[] }).items.length - 1);
  switch (key) {
    case 'up':
    case 'C-p':
      list.up(1);
      return true;
    case 'down':
    case 'C-n':
      list.down(1);
      return true;
    case 'pageup':
      list.move(-page);
      return true;
    case 'pagedown':
      list.move(page);
      return true;
    case 'home':
      list.select(0);
      return true;
    case 'end':
      list.select(last);
      return true;
    default:
      return false;
  }
}

export function createListWidget(parent: Parent, opts: ListOptions = {}): blessed.Widgets.ListElement {
  return blessed.list({
    parent,
    top: opts.top ?? 1,
    left: opts.left ?? 0,
    width: opts.width ?? '100%',
    height: opts.height ?? '100%-1',
    keys: true,
    mouse: true,
    vi: true,
    scrollable: true,
    scrollbar: { ch: '│', style: { fg: C.comment } },
    border: { type: 'line' },
    style: {
      selected: { bg: C.bgSel, fg: C.fg },
      item: { fg: C.fg },
      border: { fg: C.surface },
      focus: { border: { fg: C.purple } },
    },
    tags: true,
  });
}

export function createHeaderBar(parent: Parent, hidden = false): blessed.Widgets.BoxElement {
  return blessed.box({
    parent,
    top: 0,
    left: 0,
    width: '100%',
    height: 1,
    tags: true,
    style: { bg: C.surface },
    hidden,
  });
}

export function createCenteredMessage(parent: Parent): blessed.Widgets.BoxElement {
  return blessed.box({
    parent,
    top: 'center',
    left: 'center',
    width: '60%',
    height: 1,
    tags: true,
    hidden: true,
  });
}
