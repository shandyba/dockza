import { dockerode } from '@docker/client';
import type { ImageInfo } from '@models/docker';

export async function listImages(): Promise<ImageInfo[]> {
  try {
    const [rawImages, rawContainers] = await Promise.all([
      dockerode.listImages({ all: false }),
      dockerode.listContainers({ all: true }),
    ]);

    const usedImageIds = new Set(rawContainers.map((c) => c.ImageID));

    return rawImages
      .sort((a, b) => (a.RepoTags?.[0] ?? '').localeCompare(b.RepoTags?.[0] ?? ''))
      .map((img) => {
        const repoTag = img.RepoTags?.[0] ?? '<none>:<none>';
        const colonIdx = repoTag.lastIndexOf(':');
        const repository = colonIdx >= 0 ? repoTag.slice(0, colonIdx) || '<none>' : '<none>';
        const tag = colonIdx >= 0 ? repoTag.slice(colonIdx + 1) || '<none>' : '<none>';

        return {
          id: img.Id,
          repository,
          tag,
          sizeMB: img.Size / 1024 / 1024,
          created: new Date(img.Created * 1000),
          inUse: usedImageIds.has(img.Id),
        };
      });
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
