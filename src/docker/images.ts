import type Dockerode from 'dockerode';
import { dockerode } from '@docker/client';
import type { ImageInfo } from '@models/docker';

const UNTAGGED = '<none>:<none>';

/**
 * `repo:tag` → its halves, split at the last colon so a registry port stays in the repository. The
 * containerd store also lists an image pulled by digest as `repo@sha256:…`: that splits at the `@`.
 */
function splitRef(ref: string): { repository: string; tag: string } {
  const at = ref.indexOf('@');
  const cut = at >= 0 ? at : ref.lastIndexOf(':');
  if (cut < 0) return { repository: '<none>', tag: '<none>' };
  return { repository: ref.slice(0, cut) || '<none>', tag: ref.slice(cut + 1) || '<none>' };
}

/**
 * An image as the daemon lists it. `users` / `inUse` start empty: which containers run it comes
 * from the container listing, which App owns and joins in (`withImageUsers`).
 */
export function toImageInfo(raw: Dockerode.ImageInfo): ImageInfo {
  const tags = (raw.RepoTags ?? []).filter((t) => t !== UNTAGGED);
  const { repository, tag } = splitRef(tags[0] ?? UNTAGGED);
  return {
    id: raw.Id,
    tags,
    repository,
    tag,
    sizeMB: raw.Size / 1024 / 1024,
    created: new Date(raw.Created * 1000),
    users: [],
    inUse: false,
    supersededBy: [],
  };
}

/** What only an image's own inspect says: the paths its `VOLUME` instructions declare. */
export interface ImageInspect {
  volumes: string[];
}

export function toImageInspect(raw: Pick<Dockerode.ImageInspectInfo, 'Config'>): ImageInspect {
  return { volumes: Object.keys(raw.Config?.Volumes ?? {}).sort() };
}

/** An image never changes under its ID, so neither does its inspect: one call each, ever. */
const inspected = new Map<string, Promise<ImageInspect>>();

export function inspectImage(id: string): Promise<ImageInspect> {
  const cached = inspected.get(id);
  if (cached) return cached;
  const pending = dockerode
    .getImage(id)
    .inspect()
    .then(toImageInspect)
    .catch((err: unknown) => {
      // Not cached: the next poll tries again.
      inspected.delete(id);
      throw new Error(`Failed to inspect image ${id}: ${err instanceof Error ? err.message : String(err)}`);
    });
  inspected.set(id, pending);
  return pending;
}

export async function listImages(): Promise<ImageInfo[]> {
  try {
    const rawImages = await dockerode.listImages({ all: false });
    return rawImages
      .map(toImageInfo)
      .sort((a, b) => (a.tags[0] ?? UNTAGGED).localeCompare(b.tags[0] ?? UNTAGGED));
  } catch (err) {
    throw new Error(`Failed to list images: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function removeImage(id: string): Promise<void> {
  try {
    await dockerode.getImage(id).remove();
  } catch (err) {
    throw new Error(`Failed to remove image ${id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
