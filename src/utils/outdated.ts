import type { ContainerInfo, ImageInfo } from '@models/docker';

const DOCKER_HUB = 'docker.io/';
const OFFICIAL = 'library/';

/**
 * An image name in the one form the daemon lists tags in, so a container's configured name can be
 * looked up among them: Docker Hub's `docker.io/` and `library/` dropped, `:latest` made explicit.
 * `null` for a digest reference (`…@sha256:…`) or an image ID, which name one image forever and so
 * can never be outdated.
 */
export function normalizeImageName(name: string): string | null {
  if (name === '' || name.includes('@') || name.startsWith('sha256:')) return null;
  let n = name.startsWith(DOCKER_HUB) ? name.slice(DOCKER_HUB.length) : name;
  // `library/postgres` is `postgres`; anything deeper (`library/x/y`) is a real namespace.
  if (n.startsWith(OFFICIAL) && n.indexOf('/', OFFICIAL.length) < 0) n = n.slice(OFFICIAL.length);
  // A colon after the last slash is the tag's; one before it belongs to a registry's port.
  if (n.lastIndexOf(':') <= n.lastIndexOf('/')) n += ':latest';
  return n;
}

/**
 * Marks each container whose image name now tags a different image than the one it runs — the tag
 * was re-pulled or rebuilt since it was created — with that tag and the image now carrying it.
 * Returns new containers; one that isn't outdated (any more) carries no `outdated`.
 */
export function markOutdated(containers: ContainerInfo[], images: ImageInfo[]): ContainerInfo[] {
  const byTag = new Map<string, { tag: string; id: string }>();
  for (const img of images) {
    for (const tag of img.tags) {
      const key = normalizeImageName(tag);
      if (key) byTag.set(key, { tag, id: img.id });
    }
  }
  return containers.map((c) => {
    const { outdated: _stale, ...rest } = c;
    const key = normalizeImageName(c.imageName);
    const current = key ? byTag.get(key) : undefined;
    if (!current || !c.imageId || current.id === c.imageId) return rest;
    return { ...rest, outdated: { tag: current.tag, currentImageId: current.id } };
  });
}

/**
 * The image to show for a container. The list names an outdated one by ID (its name now tags
 * another image), so show the name it was created from: the marker beside it says it moved on.
 */
export function shownImage(c: Pick<ContainerInfo, 'image' | 'imageName' | 'outdated'>): string {
  return c.outdated ? c.imageName : c.image;
}
