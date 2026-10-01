import type { ContainerInfo, ImageInfo, VolumeInfo, VolumeProvenance } from '@models/docker';
import { imageLabel } from '@utils/nav-history';

/** `/data/` and `/data` are one path. */
const clean = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path);

/**
 * The images whose `VOLUME`s created each anonymous volume in use: a user mounts it where the
 * image it runs declares one. Docker records nothing else, so an unused anonymous volume (or one
 * mounted elsewhere, by `-v` with no name) gets none. `declared` holds each image's `VOLUME` paths
 * by image ID; images not in it yet are skipped. Returns new volumes; the rest carry no provenance.
 */
export function withProvenance(
  volumes: VolumeInfo[],
  containers: ContainerInfo[],
  declared: Map<string, string[]>,
  images: ImageInfo[],
): VolumeInfo[] {
  const byId = new Map(containers.map((c) => [c.id, c]));
  const imageById = new Map(images.map((img) => [img.id, img]));
  return volumes.map((v) => {
    const { provenance: _stale, ...rest } = v;
    if (!v.anonymous) return rest;
    const found = new Map<string, VolumeProvenance>();
    for (const u of v.users) {
      const c = byId.get(u.id);
      const paths = c ? declared.get(c.imageId) : undefined;
      if (!c || !paths?.some((p) => clean(p) === clean(u.destination))) continue;
      const img = imageById.get(c.imageId);
      const image = img ? imageLabel(img) : c.imageName;
      found.set(`${c.imageId}|${clean(u.destination)}`, {
        imageId: c.imageId,
        image,
        path: clean(u.destination),
      });
    }
    return found.size > 0 ? { ...rest, provenance: [...found.values()] } : rest;
  });
}

/** Images worth an inspect: those run by containers mounting an anonymous volume. */
export function imagesToInspect(volumes: VolumeInfo[], containers: ContainerInfo[]): string[] {
  const anonymous = new Set(volumes.filter((v) => v.anonymous).map((v) => v.name));
  const ids = containers
    .filter((c) => c.imageId && c.mounts.some((m) => m.type === 'volume' && m.name && anonymous.has(m.name)))
    .map((c) => c.imageId);
  return [...new Set(ids)];
}
