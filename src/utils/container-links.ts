import type { ContainerInfo, ContainerLink, ContainerRelation, ContainerUser } from '@models/docker';

const ORDER: ContainerRelation[] = [
  'depends-on',
  'needed-by',
  'network-of',
  'shares-network',
  'volumes-from',
  'lends-volumes',
];

const user = ({ id, name, status, exitCode }: ContainerInfo): ContainerUser => ({
  id,
  name,
  status,
  exitCode,
});

/** A container as `--network container:` / `--volumes-from` name it: full or short ID, or name. */
function resolver(containers: ContainerInfo[]): (ref: string) => ContainerInfo | undefined {
  return (ref) =>
    containers.find((c) => c.id === ref || c.name === ref) ??
    (ref.length >= 4 ? containers.find((c) => c.id.startsWith(ref)) : undefined);
}

/**
 * How containers relate to each other, both ways round, for each one's DEPENDS ON section:
 *
 *   - compose `depends_on`: the services named, resolved to the containers running them in the same
 *     project (`depends-on`), and back (`needed-by`). A service with no container left still shows;
 *   - `--network container:x`: whose network stack it runs in (`network-of`), and back;
 *   - `--volumes-from x`: whose volumes it mounts too (`volumes-from`), and back.
 *
 * Returns new containers, every one with `links` set (empty when it relates to none).
 */
export function withLinks(containers: ContainerInfo[]): ContainerInfo[] {
  const links = new Map<string, ContainerLink[]>(containers.map((c) => [c.id, []]));
  const add = (c: ContainerInfo, link: ContainerLink): void => {
    links.get(c.id)?.push(link);
  };
  const resolve = resolver(containers);

  for (const c of containers) {
    const compose = c.compose;
    for (const service of compose?.dependsOn ?? []) {
      const runners = containers.filter(
        (o) =>
          o.id !== c.id &&
          o.compose?.project === compose?.project &&
          o.compose?.service === service &&
          !o.compose.oneoff,
      );
      if (runners.length === 0) add(c, { relation: 'depends-on', target: service, service });
      for (const o of runners) {
        add(c, { relation: 'depends-on', container: user(o), target: o.name, service });
        add(o, { relation: 'needed-by', container: user(c), target: c.name, service });
      }
    }

    pair(c, c.networkMode?.container, 'network-of', 'shares-network');
    for (const from of c.volumesFrom) pair(c, from, 'volumes-from', 'lends-volumes');
  }

  function pair(
    c: ContainerInfo,
    ref: string | undefined,
    there: ContainerRelation,
    back: ContainerRelation,
  ): void {
    if (!ref) return;
    const o = resolve(ref);
    if (!o) return add(c, { relation: there, target: ref });
    add(c, { relation: there, container: user(o), target: o.name });
    add(o, { relation: back, container: user(c), target: c.name });
  }

  const rank = (l: ContainerLink): number => ORDER.indexOf(l.relation);
  return containers.map((c) => ({
    ...c,
    links: (links.get(c.id) ?? []).sort((a, b) => rank(a) - rank(b) || a.target.localeCompare(b.target)),
  }));
}
