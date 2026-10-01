import type { ContainerInfo, ImageInfo, NetworkInfo, VolumeInfo } from '@models/docker';
import type { Location, PanelLoc, ResourceRef, ViewId } from '@models/nav';
import { shortId } from '@utils/format';
import type { Stack } from '@utils/stacks';

const DEFAULT_CAP = 100;

/**
 * Back / forward history, like a browser's. `push` drops whatever was ahead; `back` and `forward`
 * skip entries that are the same place as the current one, so no key press is spent going nowhere.
 * `same` decides what counts as one place: navigating to the place you're at replaces it instead.
 */
export class NavHistory<T> {
  private entries: T[] = [];
  private index = -1;

  constructor(
    private readonly same: (a: T, b: T) => boolean,
    private readonly cap = DEFAULT_CAP,
  ) {}

  reset(entry: T): void {
    this.entries = [entry];
    this.index = 0;
  }

  current(): T | null {
    return this.entries[this.index] ?? null;
  }

  /** Update where we are without making it a step, e.g. the row the user moved to before leaving. */
  replaceCurrent(entry: T): void {
    if (this.index < 0) this.reset(entry);
    else this.entries[this.index] = entry;
  }

  push(entry: T): void {
    const current = this.current();
    if (current === null) return this.reset(entry);
    if (this.same(current, entry)) return this.replaceCurrent(entry);
    this.entries.splice(this.index + 1);
    this.entries.push(entry);
    if (this.entries.length > this.cap) this.entries.splice(0, this.entries.length - this.cap);
    this.index = this.entries.length - 1;
  }

  /** Moves back and returns the entry, or `null` (staying put) when there is nowhere else to go. */
  back(): T | null {
    return this.step(-1);
  }

  forward(): T | null {
    return this.step(1);
  }

  private step(dir: 1 | -1): T | null {
    const current = this.current();
    if (current === null) return null;
    let i = this.index + dir;
    while (i >= 0 && i < this.entries.length && this.same(this.entries[i], current)) i += dir;
    if (i < 0 || i >= this.entries.length) return null;
    this.index = i;
    return this.entries[i];
  }
}

export function sameRef(a: ResourceRef, b: ResourceRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

function samePanel(a: PanelLoc | undefined, b: PanelLoc | undefined): boolean {
  if (!a || !b) return a === b;
  return a.kind === b.kind && sameRef(a.ref, b.ref);
}

/** One place = the same view with the same panel open. The selected row and focus are just state. */
export function samePlace(a: Location, b: Location): boolean {
  return a.view === b.view && samePanel(a.panel, b.panel);
}

const VIEW_FOR: Record<ResourceRef['kind'], ViewId> = {
  container: 'containers',
  volume: 'volumes',
  image: 'images',
  network: 'networks',
  stack: 'stacks',
};

/** The view a reference opens in. */
export function viewForRef(ref: ResourceRef): ViewId {
  return VIEW_FOR[ref.kind];
}

/** `container tk-t2-pg`, for messages. */
export function describeRef(ref: ResourceRef): string {
  return `${ref.kind} ${ref.label ?? ref.id}`;
}

export function containerRef(c: Pick<ContainerInfo, 'id' | 'name'>): ResourceRef {
  return { kind: 'container', id: c.id, label: c.name };
}

export function volumeRef(v: Pick<VolumeInfo, 'name'>): ResourceRef {
  return { kind: 'volume', id: v.name };
}

/** How an image is named: its first tag, or its short ID when it has none. */
export function imageLabel(img: Pick<ImageInfo, 'id' | 'tags'>): string {
  return img.tags[0] ?? shortId(img.id);
}

/** By full ID (`sha256:…`), as the Images list keys its rows; named by the tag it shows. */
export function imageRef(img: Pick<ImageInfo, 'id' | 'tags'>): ResourceRef {
  return { kind: 'image', id: img.id, label: imageLabel(img) };
}

/** By name, not ID: a stopped container can hold a stale network ID (see `withNetworkUsers`). */
export function networkRef(net: Pick<NetworkInfo, 'name'>): ResourceRef {
  return { kind: 'network', id: net.name };
}

export function stackRef(stack: Pick<Stack, 'id'>): ResourceRef {
  return { kind: 'stack', id: stack.id };
}
