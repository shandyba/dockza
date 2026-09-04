import type blessed from 'neo-blessed';
import { removeVolume } from '@docker/volumes';
import type { VolumeInfo } from '@models/docker';
import { t } from '@theme';
import { humanSizeMB, truncate } from '@utils/format';
import { ResourceListTab } from '@ui/resource-list-tab';
import type { Dims, RunMutation } from '@ui/widgets';

export class VolumesTab extends ResourceListTab<VolumeInfo> {
  constructor(screen: blessed.Widgets.Screen, dims: Dims, runMutation: RunMutation) {
    super(
      screen,
      dims,
      {
        remove: (vol) => removeVolume(vol.name),
        getKey: (vol) => vol.name,
        emptyMessage: 'No volumes',
        confirmTitle: 'Remove volume?',
        confirmLabel: (vol) => vol.name,
        guards: [(vol) => (vol.inUse ? 'Volume in use — cannot delete' : null)],
        columns: [
          { header: 'NAME', weight: 0.28, render: (vol, w) => truncate(vol.name, w - 1) },
          { header: 'DRIVER', weight: 0.12, render: (vol, w) => truncate(vol.driver, w - 1) },
          {
            header: 'MOUNTPOINT',
            weight: 0.3,
            render: (vol, w) => t.comment(truncate(vol.mountpoint, w - 1)),
          },
          {
            header: 'SIZE',
            weight: 0.1,
            render: (vol) => (vol.sizeMB > 0 ? humanSizeMB(vol.sizeMB) : t.comment('—')),
          },
          {
            header: 'STATUS',
            weight: 0,
            render: (vol) => (vol.inUse ? t.green('● in use') : t.red('○ unused')),
          },
        ],
      },
      runMutation,
    );
  }
}
