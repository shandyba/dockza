import type { VolumeInfo } from '@models/docker';
import { imageRef } from '@utils/nav-history';
import { textOption } from '@ui/copy-menu';
import { projectRow, type RelatedRow } from '@ui/detail/related-rows';

/**
 * Where a volume came from, as far as Docker can tell: its compose project, or that it's anonymous
 * — and then, while a container uses it, the image whose `VOLUME` it was created for.
 */
export function volumeRelated(v: VolumeInfo): RelatedRow[] {
  const rows: RelatedRow[] = [];
  if (v.stack) {
    rows.push(projectRow(v.stack, v.composeVolume && `volume ${v.composeVolume}`, v.orphaned === true));
  }
  if (v.anonymous) rows.push({ key: 'anonymous', label: 'origin', text: 'anonymous', ref: null, copy: [] });
  for (const p of v.provenance ?? []) {
    rows.push({
      key: `image:${p.imageId}:${p.path}`,
      label: 'image',
      text: p.image,
      note: `declares VOLUME ${p.path}`,
      ref: imageRef({ id: p.imageId, tags: [p.image] }),
      copy: [
        textOption('n', 'image name', p.image, 'image name'),
        textOption('i', 'image ID', p.imageId, 'image ID'),
        textOption('d', 'VOLUME path', p.path, 'path'),
      ],
    });
  }
  return rows;
}
