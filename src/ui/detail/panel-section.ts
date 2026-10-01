import type { ResourceRef } from '@models/nav';
import type { CopyOption } from '@ui/copy-menu';

export interface SectionRender {
  /** Header first, then the rows. */
  lines: string[];
  /**
   * Lines holding the cursor's row, relative to the header — only while the section has the
   * cursor. Starting it at the header for the first row makes revealing that row show the title too.
   */
  activeRange: [number, number] | null;
}

/** `changed`: re-render. `{ goto }`: the row is a link, follow it. */
export type SectionKeyResult = 'ignored' | 'changed' | { goto: ResourceRef };

/**
 * A run of selectable rows inside a detail panel (MOUNTS, ENV, USED BY, …). The panel owns the
 * cursor's travel between sections (Tab), scrolling, and the copy menu; a section owns its rows,
 * which one is selected, and the keys that act on that row. Blessed-free, so it unit-tests.
 */
export interface PanelSection {
  /** Stable name: footer context, history focus. */
  readonly id: string;
  /** Has a row the cursor can sit on. Tab skips sections that don't. */
  focusable(): boolean;
  /** The cursor arrives (Tab or the section's own key). ENV opens itself here. */
  onFocus?(): void;
  /** `cols`: the widest a line may be; blessed wraps anything wider. */
  render(cols: number, focused: boolean): SectionRender;
  move(delta: number): void;
  first(): void;
  last(): void;
  atFirst(): boolean;
  atLast(): boolean;
  /** Keys other than the cursor's travel (↵, →, ←, …), for the selected row. */
  onKey(key: string): SectionKeyResult;
  /** Copy menu for the selected row. */
  copyOptions(): CopyOption[];
  /** Key of the selected row, so history can bring the cursor back to it. */
  rowKey(): string | undefined;
  /** Select the row with this key; false (selection unchanged) when it is gone. */
  selectRow(key: string): boolean;
}
