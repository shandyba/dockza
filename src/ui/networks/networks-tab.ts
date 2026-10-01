import type blessed from 'neo-blessed';
import { removeNetwork } from '@docker/networks';
import type { NetworkInfo } from '@models/docker';
import { t } from '@theme';
import { relativeTime, shortId, truncate } from '@utils/format';
import { formatUsedBy } from '@utils/list-cells';
import { NetworkDetail } from '@ui/networks/network-detail';
import { ResourceListTab } from '@ui/resource-list-tab';
import type { TabNav } from '@ui/view-tab';
import type { Dims, RunMutation } from '@ui/widgets';

export class NetworksTab extends ResourceListTab<NetworkInfo> {
  constructor(screen: blessed.Widgets.Screen, dims: Dims, runMutation: RunMutation, nav: TabNav) {
    super(
      screen,
      dims,
      {
        view: 'networks',
        footer: 'networks',
        remove: (net) => removeNetwork(net.id),
        // By name, like every link to a network: a stopped container can hold a stale ID.
        getKey: (net) => net.name,
        emptyMessage: 'No networks',
        confirmTitle: 'Remove network?',
        confirmLabel: (net) => net.name,
        guards: [
          (net) => (net.builtin ? 'Built-in network — cannot delete' : null),
          (net) => (net.inUse ? 'Network in use — cannot delete' : null),
        ],
        detail: {
          kind: 'network',
          create: (s, d) => new NetworkDetail(s, d),
          footer: 'network-detail',
        },
        columns: [
          { header: 'NAME', weight: 0.22, render: (net, w) => truncate(net.name, w - 1) },
          { header: 'DRIVER', weight: 0.1, render: (net, w) => truncate(net.driver, w - 1) },
          { header: 'SCOPE', weight: 0.08, render: (net, w) => t.comment(truncate(net.scope, w - 1)) },
          { header: 'ID', weight: 0.12, render: (net, w) => t.comment(truncate(shortId(net.id), w - 1)) },
          { header: 'USED BY', weight: 0.2, render: (net, w) => formatUsedBy(net.users, w) },
          {
            header: 'CREATED',
            weight: 0.14,
            render: (net, w) =>
              t.comment(net.created.getTime() > 0 ? truncate(relativeTime(net.created), w - 1) : '—'),
          },
          {
            header: 'STATUS',
            weight: 0,
            render: (net) =>
              net.inUse ? t.green('● in use') : t.red(net.orphaned ? '○ orphaned' : '○ unused'),
          },
        ],
      },
      runMutation,
      nav,
    );
  }
}
