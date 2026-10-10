import type blessed from 'neo-blessed';
import { removeVolume } from '@docker/volumes';
import type { VolumeInfo } from '@models/docker';
import { t } from '@theme';
import { volumeFilterFields } from '@utils/filter';
import { humanSizeMB, truncate } from '@utils/format';
import { formatUsedBy } from '@utils/list-cells';
import { unusedLabel } from '@utils/orphans';
import { ResourceListTab } from '@ui/resource-list-tab';
import { VolumeDetail } from '@ui/volumes/volume-detail';
import type { TabNav } from '@ui/view-tab';
import type { Dims, RunMutation } from '@ui/widgets';

export class VolumesTab extends ResourceListTab<VolumeInfo> {
  constructor(screen: blessed.Widgets.Screen, dims: Dims, runMutation: RunMutation, nav: TabNav) {
    super(
      screen,
      dims,
      {
        view: 'volumes',
        footer: 'volumes',
        noun: 'volume',
        remove: (vol) => removeVolume(vol.name),
        getKey: (vol) => vol.name,
        emptyMessage: 'No volumes',
        confirmTitle: 'Remove volume?',
        confirmLabel: (vol) => vol.name,
        filterFields: volumeFilterFields,
        guards: [(vol) => (vol.inUse ? 'Volume in use — cannot delete' : null)],
        cleanups: [
          {
            key: 'd',
            label: 'Dangling',
            detail: 'anonymous, and no container mounts them',
            matches: (vol) => vol.dangling === true,
          },
          {
            key: 'o',
            label: 'Orphaned',
            detail: 'their compose project has no containers left',
            matches: (vol) => vol.orphaned === true,
          },
          {
            key: 'u',
            label: 'All unused',
            detail: 'every volume no container mounts',
            matches: (vol) => !vol.inUse,
          },
        ],
        sizeMB: (vol) => vol.sizeMB,
        detail: {
          kind: 'volume',
          create: (s, d) => new VolumeDetail(s, d),
          footer: 'volume-detail',
        },
        columns: [
          { header: 'NAME', weight: 0.25, render: (vol, w) => truncate(vol.name, w - 1) },
          { header: 'DRIVER', weight: 0.08, render: (vol, w) => truncate(vol.driver, w - 1) },
          { header: 'USED BY', weight: 0.17, render: (vol, w) => formatUsedBy(vol.users, w) },
          {
            header: 'MOUNTPOINT',
            weight: 0.27,
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
            render: (vol) => (vol.inUse ? t.green('● in use') : t.red(unusedLabel(vol))),
          },
        ],
      },
      runMutation,
      nav,
    );
  }
}
