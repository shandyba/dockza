import type { NetworkInfo } from '@models/docker';
import { projectRow, type RelatedRow } from '@ui/detail/related-rows';

/** The compose project a network was created for, from its labels. */
export function networkRelated(net: NetworkInfo): RelatedRow[] {
  if (!net.stack) return [];
  return [
    projectRow(net.stack, net.composeNetwork && `network ${net.composeNetwork}`, net.orphaned === true),
  ];
}
