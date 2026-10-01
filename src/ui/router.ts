import type { Location, PanelLoc, ResourceRef, ViewId } from '@models/nav';
import { NavHistory, samePlace, viewForRef } from '@utils/nav-history';
import type { ViewTab } from '@ui/view-tab';

export interface RouterHost {
  /** Help, a confirm or the filter is open: navigation does nothing. */
  isInert(): boolean;
  /** After every navigation, so App can update the rail and footer. */
  onNavigated(view: ViewId): void;
  /** `gone`: a step's target was removed. `unlisted`: a link's target isn't in its view's data yet. */
  onMissing(ref: ResourceRef, reason: 'gone' | 'unlisted'): void;
}

/**
 * Every user navigation — switching views, opening and closing panels, following links, back and
 * forward — goes through here, so all of it lands in one history.
 *
 * Each step first snapshots where the user is (the row they moved to, the section their cursor is
 * in) into the current entry, then records the target and applies it. Applying shows / hides tabs
 * only when the view changes, and always lets the target tab `restore` the location.
 */
export class Router {
  private active: ViewId;
  private readonly history = new NavHistory<Location>(samePlace);
  private applying = false;

  constructor(
    private readonly tabs: Record<ViewId, ViewTab>,
    private readonly host: RouterHost,
    initial: ViewId,
  ) {
    this.active = initial;
  }

  /** Shows the first view and makes it the start of the history. */
  start(): void {
    this.tabs[this.active].show();
    this.history.reset(this.tabs[this.active].location());
    this.host.onNavigated(this.active);
  }

  activeView(): ViewId {
    return this.active;
  }

  activeTab(): ViewTab {
    return this.tabs[this.active];
  }

  /** Go to a view as it was left. False when navigation is off right now. */
  switchTo(view: ViewId): boolean {
    return this.navigate({ view });
  }

  /** Open (or with `null` close) a panel over `view`'s list. Only the active view has panels. */
  open(view: ViewId, panel: PanelLoc | null): boolean {
    if (view !== this.active) return false;
    const here: Location = { ...this.tabs[view].location() };
    delete here.panel;
    return this.navigate(panel ? { ...here, panel } : here);
  }

  /** Open the detail of whatever `ref` points at, in the view that lists it. */
  follow(ref: ResourceRef): boolean {
    if (this.blocked()) return false;
    const view = viewForRef(ref);
    if (!this.tabs[view].has(ref)) {
      this.host.onMissing(ref, 'unlisted');
      return false;
    }
    return this.navigate({ view, panel: { kind: 'detail', ref } });
  }

  back(): boolean {
    return this.step(() => this.history.back());
  }

  forward(): boolean {
    return this.step(() => this.history.forward());
  }

  private navigate(target: Location): boolean {
    if (this.blocked()) return false;
    this.snapshot();
    this.history.push(target);
    this.apply(target);
    return true;
  }

  private step(move: () => Location | null): boolean {
    if (this.blocked()) return false;
    this.snapshot();
    const target = move();
    if (!target) return false;
    this.apply(target);
    return true;
  }

  private blocked(): boolean {
    return this.applying || this.host.isInert();
  }

  private apply(target: Location): void {
    this.applying = true;
    let ok: boolean;
    try {
      if (target.view !== this.active) {
        this.tabs[this.active].hide();
        this.active = target.view;
        this.tabs[this.active].show();
      }
      ok = this.tabs[this.active].restore(target);
    } finally {
      this.applying = false;
    }
    // Record what actually happened: the row the tab settled on, or its list if the target is gone.
    this.snapshot();
    if (!ok && target.panel) this.host.onMissing(target.panel.ref, 'gone');
    this.host.onNavigated(this.active);
  }

  private snapshot(): void {
    this.history.replaceCurrent(this.tabs[this.active].location());
  }
}
