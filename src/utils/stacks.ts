import type { ContainerInfo, NetworkInfo, VolumeInfo } from '@models/docker';
import { COMPOSE_PROJECT_LABEL } from '@utils/compose';
import { anonymousVolumes } from '@utils/mounts';

export const NO_STACK = '(no stack)';
const DEFAULT_NETWORK_SUFFIX = '_default';

export interface StackCounts {
  running: number;
  errored: number;
  stopped: number;
}

export interface Stack {
  id: string;
  isCompose: boolean;
  services: ContainerInfo[];
  counts: StackCounts;
  isLive: boolean;
}

export type ServiceClass = 'running' | 'errored' | 'stopped';

export function classifyContainer(c: ContainerInfo): ServiceClass {
  if (c.status === 'running' || c.status === 'paused' || c.status === 'restarting') {
    return 'running';
  }
  if ((c.status === 'exited' || c.status === 'dead') && c.exitCode !== 0) {
    return 'errored';
  }
  return 'stopped';
}

/**
 * The stack a container belongs to: its compose project, or — for one compose didn't label — the
 * project its `<project>_default` network names. `NO_STACK` when neither says.
 */
export function detectStack(c: Pick<ContainerInfo, 'labels' | 'networks'>): {
  id: string;
  isCompose: boolean;
} {
  const labeled = c.labels[COMPOSE_PROJECT_LABEL];
  if (labeled) return { id: labeled, isCompose: true };
  for (const net of c.networks) {
    if (net.name.endsWith(DEFAULT_NETWORK_SUFFIX)) {
      return { id: net.name.slice(0, -DEFAULT_NETWORK_SUFFIX.length), isCompose: true };
    }
  }

  return { id: NO_STACK, isCompose: false };
}

const CLASS_ORDER: Record<ServiceClass, number> = { running: 0, errored: 1, stopped: 2 };

function compareServices(a: ContainerInfo, b: ContainerInfo): number {
  const ca = CLASS_ORDER[classifyContainer(a)];
  const cb = CLASS_ORDER[classifyContainer(b)];
  if (ca !== cb) return ca - cb;
  return a.name.localeCompare(b.name);
}

export function groupIntoStacks(containers: ContainerInfo[]): Stack[] {
  const grouped = new Map<string, { isCompose: boolean; services: ContainerInfo[] }>();

  for (const c of containers) {
    const { id, isCompose } = detectStack(c);
    const existing = grouped.get(id);
    if (existing) {
      existing.services.push(c);
      if (isCompose) existing.isCompose = true;
    } else {
      grouped.set(id, { isCompose, services: [c] });
    }
  }

  const stacks: Stack[] = [];
  for (const [id, { isCompose, services }] of grouped) {
    const counts: StackCounts = { running: 0, errored: 0, stopped: 0 };
    for (const c of services) counts[classifyContainer(c)]++;
    stacks.push({
      id,
      isCompose,
      services: [...services].sort(compareServices),
      counts,
      isLive: counts.running > 0,
    });
  }

  stacks.sort((a, b) => {
    if (a.id === NO_STACK && b.id !== NO_STACK) return 1;
    if (b.id === NO_STACK && a.id !== NO_STACK) return -1;
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    if (a.isLive) return b.counts.running - a.counts.running;
    return b.services.length - a.services.length;
  });

  return stacks;
}

/** Where a stack's compose project lives, from its services' labels. Empty when compose didn't label it. */
export function stackCompose(stack: Pick<Stack, 'services'>): { configFiles: string[]; workingDir?: string } {
  const labelled = stack.services.find((c) => c.compose && c.compose.configFiles.length > 0);
  const workingDir = stack.services.find((c) => c.compose?.workingDir)?.compose?.workingDir;
  return { configFiles: labelled?.compose?.configFiles ?? [], ...(workingDir ? { workingDir } : {}) };
}

/** The volumes and networks App lists, for picking out a stack's own. */
export interface StackResources {
  volumes: VolumeInfo[];
  networks: NetworkInfo[];
}

/** A stack's own volumes and networks: those its compose project labelled, and its default network. */
export function stackResources(stack: Pick<Stack, 'id'>, all: StackResources): StackResources {
  return {
    volumes: all.volumes.filter((v) => v.stack === stack.id),
    networks: all.networks.filter((n) => n.stack === stack.id || n.name === `${stack.id}_default`),
  };
}

/** Its compose services, without the one-off containers `compose run` left: what compose starts and restarts. */
export function serviceContainers(stack: Pick<Stack, 'services'>): ContainerInfo[] {
  return stack.services.filter((c) => !c.compose?.oneoff);
}

/**
 * The order compose starts containers in: each wave after the services its members depend on. A
 * dependency that isn't among them doesn't hold anything up; a cycle starts the rest together.
 * Stopping goes through the waves backwards.
 */
export function startWaves(containers: ContainerInfo[]): ContainerInfo[][] {
  const serviceOf = (c: ContainerInfo): string => c.compose?.service || c.name;
  const present = new Set(containers.map(serviceOf));
  const done = new Set<string>();
  const waves: ContainerInfo[][] = [];
  let rest = containers;
  while (rest.length > 0) {
    const ready = rest.filter((c) =>
      (c.compose?.dependsOn ?? []).every((dep) => dep === serviceOf(c) || done.has(dep) || !present.has(dep)),
    );
    const wave = ready.length > 0 ? ready : rest;
    waves.push(wave);
    for (const c of wave) done.add(serviceOf(c));
    rest = rest.filter((c) => !wave.includes(c));
  }
  return waves;
}

/** What taking a stack down removes, as `docker compose down` would, and with `-v`. */
export interface StackDownPlan {
  containers: ContainerInfo[];
  /** Its networks, the default one included. */
  networks: NetworkInfo[];
  /** The named volumes its project created: deleted only with `-v`. */
  volumes: VolumeInfo[];
  /** Anonymous volumes its containers mount: deleted only with `-v`. */
  anonymous: string[];
  /** Its volumes and networks a container outside the stack still uses: kept either way. */
  shared: number;
}

export function stackDownPlan(stack: Stack, all: StackResources): StackDownPlan {
  const own = stackResources(stack, all);
  const ids = new Set(stack.services.map((c) => c.id));
  const onlyOurs = (users: Array<{ id: string }>): boolean => users.every((u) => ids.has(u.id));
  const networks = own.networks.filter((n) => onlyOurs(n.users));
  const volumes = own.volumes.filter((v) => onlyOurs(v.users));
  return {
    containers: stack.services,
    networks,
    volumes,
    anonymous: anonymousVolumes(stack.services),
    shared: own.networks.length - networks.length + own.volumes.length - volumes.length,
  };
}
