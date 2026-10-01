import type { ContainerInfo } from '@models/docker';
import { imageRef, stackRef } from '@utils/nav-history';
import { detectStack, NO_STACK } from '@utils/stacks';
import { textOption } from '@ui/copy-menu';
import type { RelatedRow } from '@ui/detail/related-rows';

/**
 * What a container has exactly one of, for its RELATED section: the image it runs (and whether
 * its tag has moved on to a newer one), and the stack it belongs to.
 */
export function containerRelated(c: ContainerInfo): RelatedRow[] {
  const stack = stackRow(c);
  return stack ? [imageRow(c), stack] : [imageRow(c)];
}

/**
 * Its compose project, as the Stacks view groups it. One grouped only by its `<project>_default`
 * network still gets a row, but compose's labels (files, working dir) aren't there to copy.
 */
function stackRow(c: ContainerInfo): RelatedRow | null {
  const { id } = detectStack(c);
  if (id === NO_STACK) return null;
  const compose = c.compose;
  const unlabelled = 'not labelled by compose';
  return {
    key: 'stack',
    label: 'stack',
    text: id,
    ...(compose?.service ? { note: `· service ${compose.service}` } : {}),
    ref: stackRef({ id }),
    copy: [
      textOption('n', 'project', id, 'project'),
      {
        ...textOption('f', 'compose files', compose?.configFiles.join('\n'), 'compose files', unlabelled),
        preview: compose?.configFiles.join(', ') ?? '',
      },
      textOption('w', 'working dir', compose?.workingDir, 'working dir', unlabelled),
    ],
  };
}

function imageRow(c: ContainerInfo): RelatedRow {
  return {
    key: 'image',
    label: 'image',
    text: c.imageName,
    ...(c.outdated ? { note: `newer image for ${c.outdated.tag} available locally`, warn: true } : {}),
    // The image it runs, which an outdated container's name no longer tags.
    ref: c.imageId ? imageRef({ id: c.imageId, tags: [c.imageName] }) : null,
    copy: [
      textOption('n', 'image name', c.imageName, 'image name'),
      textOption('i', 'image ID', c.imageId, 'image ID'),
    ],
  };
}
