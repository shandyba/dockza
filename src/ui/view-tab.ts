import type { Location, PanelLoc, ResourceRef, ViewId } from '@models/nav';
import type { FooterHints } from '@ui/footer';

/**
 * How a tab asks to go somewhere. It never opens or closes a panel on the user's say-so itself:
 * App's router records the step, then calls the tab's `restore`. So back / forward run exactly
 * the code a key press does, and no navigation can skip the history.
 */
export interface TabNav {
  /** Open a panel over this tab's list, or close the open one (`null`). */
  open(panel: PanelLoc | null): void;
  /** Follow a reference to the view that lists it (maybe this one). */
  follow(ref: ResourceRef): void;
}

type Handler = () => void;
type MessageHandler = (message: string) => void;

/** One of App's views, as the router and footer see it. */
export interface ViewTab {
  readonly view: ViewId;
  /** Both safe to call twice: a second `show` would bind every key twice. */
  show(): void;
  hide(): void;
  showLoading(): void;
  /** Re-render the current data (after a resize). */
  redraw(): void;
  /** Where the tab is now: selected row, open panel, panel focus. */
  location(): Location;
  /**
   * Go to `loc`: select its row, open its panel (or close any). `false` when the panel's target
   * no longer exists — the tab is then on its list.
   */
  restore(loc: Location): boolean;
  /** Whether `follow(ref)` can land here. */
  has(ref: ResourceRef): boolean;
  /** A named context, or the hints of the panel section holding the cursor. */
  footerContext(): FooterHints;
  /** A panel or modal is up: switching views stays off. */
  isOverlayOpen(): boolean;
  /** A confirm or the filter holds the keys: history and help stay off too. */
  isInert(): boolean;
  /** `context`: what `footerContext()` returns may have changed. */
  on(event: 'context', handler: Handler): void;
  on(event: 'error' | 'info', handler: MessageHandler): void;
}
