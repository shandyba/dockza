import type blessed from 'neo-blessed';
import { removeImage } from '@docker/images';
import type { ImageInfo } from '@models/docker';
import { t } from '@theme';
import { humanSizeMB, relativeTime, shortId, truncate } from '@utils/format';
import { formatFirst, formatUsedBy } from '@utils/list-cells';
import { imageLabel } from '@utils/nav-history';
import { ImageDetail } from '@ui/images/image-detail';
import { ResourceListTab } from '@ui/resource-list-tab';
import type { TabNav } from '@ui/view-tab';
import type { Dims, RunMutation } from '@ui/widgets';

export class ImagesTab extends ResourceListTab<ImageInfo> {
  constructor(screen: blessed.Widgets.Screen, dims: Dims, runMutation: RunMutation, nav: TabNav) {
    super(
      screen,
      dims,
      {
        view: 'images',
        footer: 'images',
        remove: (img) => removeImage(img.id),
        getKey: (img) => img.id,
        emptyMessage: 'No images',
        confirmTitle: 'Remove image?',
        confirmLabel: imageLabel,
        guards: [(img) => (img.inUse ? 'Image in use — cannot delete' : null)],
        detail: {
          kind: 'image',
          label: imageLabel,
          create: (s, d) => new ImageDetail(s, d),
          footer: 'image-detail',
        },
        columns: [
          { header: 'REPOSITORY', weight: 0.25, render: (img, w) => truncate(img.repository, w - 1) },
          {
            header: 'TAG',
            weight: 0.14,
            // The first tag's own half, then how many other tags (any repository) it carries.
            render: (img, w) => formatFirst([img.tag, ...img.tags.slice(1)], w, t.cyan),
          },
          { header: 'ID', weight: 0.11, render: (img, w) => t.comment(truncate(shortId(img.id), w - 1)) },
          {
            header: 'CREATED',
            weight: 0.13,
            render: (img, w) => t.comment(truncate(relativeTime(img.created), w - 1)),
          },
          { header: 'SIZE', weight: 0.09, render: (img) => humanSizeMB(img.sizeMB) },
          { header: 'USED BY', weight: 0.17, render: (img, w) => formatUsedBy(img.users, w) },
          {
            header: 'STATUS',
            weight: 0,
            render: (img) => (img.inUse ? t.green('● in use') : t.red('○ unused')),
          },
        ],
      },
      runMutation,
      nav,
    );
  }
}
