import type { ContainerInfo, ImageInfo, NetworkInfo, VolumeInfo } from '@models/docker';

/** The text a row is matched on. Missing fields are skipped. */
export type FilterFields = ReadonlyArray<string | undefined>;

/**
 * Whether any of `fields` contains `query`, ignoring case. The query is trimmed first, so stray
 * spaces never hide a row, and an empty query matches everything.
 */
export function matchesQuery(query: string, fields: FilterFields): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return fields.some((f) => f !== undefined && f.toLowerCase().includes(needle));
}

export function filterItems<T>(items: T[], query: string, fieldsOf: (item: T) => FilterFields): T[] {
  if (query.trim() === '') return items;
  return items.filter((item) => matchesQuery(query, fieldsOf(item)));
}

/** A container (or a stack's service): its name, image, ID, and the compose project it is in. */
export function containerFilterFields(c: ContainerInfo): FilterFields {
  return [c.name, c.image, c.id, c.compose?.project];
}

/** An image: every `repo:tag` it carries (not just the first, which the list shows) and its ID. */
export function imageFilterFields(img: ImageInfo): FilterFields {
  return [img.repository, ...img.tags, img.id];
}

export function volumeFilterFields(v: VolumeInfo): FilterFields {
  return [v.name, v.driver, v.stack];
}

export function networkFilterFields(n: NetworkInfo): FilterFields {
  return [n.name, n.driver, n.id, n.stack];
}
