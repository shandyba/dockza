export type ViewId = 'stacks' | 'containers' | 'images' | 'volumes' | 'networks';

/** Kinds of object a reference can point at: each one has a detail panel a link can open. */
export type ResourceKind = 'container' | 'volume' | 'image' | 'network' | 'stack';

/**
 * A pointer to one docker object: a container or an image by ID, a volume or a network by name,
 * a stack by its project name.
 */
export interface ResourceRef {
  kind: ResourceKind;
  id: string;
  /** Human name for messages ("container tk-t2-pg no longer exists"); defaults to the id. */
  label?: string;
}

/** Where the cursor sits inside a panel: which section, and which row of it (by the row's key). */
export interface PanelFocus {
  section: string;
  row?: string;
}

/** A panel open over a view's list: a detail panel or a log viewer, and what it shows. */
export interface PanelLoc {
  kind: 'detail' | 'logs';
  ref: ResourceRef;
  focus?: PanelFocus;
}

/** One screen the user can go back or forward to. */
export interface Location {
  view: ViewId;
  /** The list row selected in that view, by the tab's own row key. */
  selection?: string;
  panel?: PanelLoc;
}
