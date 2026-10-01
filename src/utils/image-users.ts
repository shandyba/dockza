import type { ContainerInfo, ImageInfo, ImageUser } from '@models/docker';
import { compareUsers } from '@utils/status';

/**
 * The images with the containers created from each joined in, by the exact image a container runs
 * (`ImageID`), running or stopped — the way `docker rmi` sees it. The list payload's own
 * `Containers` count is `0` or `-1`, which says nothing.
 *
 * `supersededBy` collects the tags those containers were created from that now name another image
 * (`markOutdated` must have run on `containers` first).
 */
export function withImageUsers(images: ImageInfo[], containers: ContainerInfo[]): ImageInfo[] {
  const byImage = new Map<string, ContainerInfo[]>();
  for (const c of containers) {
    if (!c.imageId) continue;
    byImage.set(c.imageId, [...(byImage.get(c.imageId) ?? []), c]);
  }
  return images.map((img) => {
    const using = byImage.get(img.id) ?? [];
    const users: ImageUser[] = using
      .map(({ id, name, status, exitCode }) => ({ id, name, status, exitCode }))
      .sort(compareUsers);
    const supersededBy = [...new Set(using.flatMap((c) => (c.outdated ? [c.outdated.tag] : [])))].sort();
    return { ...img, users, inUse: users.length > 0, supersededBy };
  });
}
