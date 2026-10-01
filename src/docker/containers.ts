import type Dockerode from 'dockerode';
import { dockerode } from '@docker/client';
import type {
  ContainerInfo,
  ContainerStats,
  ContainerStatus,
  MountInfo,
  MountType,
  NetworkEndpoint,
} from '@models/docker';
import { composeInfo } from '@utils/compose';
import { humanUptime, relativeTime, shortId } from '@utils/format';
import { toPorts } from '@utils/ports';
import { calcCPUPercent } from '@utils/stats';

const VALID_STATUSES = new Set<ContainerStatus>([
  'running',
  'paused',
  'exited',
  'restarting',
  'dead',
  'created',
  'removing',
]);

/** A mount from either payload: `listContainers` and `inspect` describe them the same way. */
interface RawMount {
  Type?: string;
  Name?: string;
  Driver?: string;
  Source?: string;
  Destination?: string;
  Mode?: string;
  RW?: boolean;
}

export function toMountInfo(m: RawMount): MountInfo {
  return {
    type: (m.Type as MountType) || 'bind',
    ...(m.Name ? { name: m.Name } : {}),
    ...(m.Driver ? { driver: m.Driver } : {}),
    source: m.Source ?? '',
    destination: m.Destination ?? '',
    mode: m.Mode ?? '',
    rw: m.RW ?? false,
  };
}

/** A network endpoint from either payload. The list leaves `Aliases` / `DNSNames` null. */
interface RawEndpoint {
  IPAddress?: string;
  Gateway?: string;
  Aliases?: string[] | null;
  DNSNames?: string[] | null;
}

/**
 * The networks a container is attached to, keyed by name (see `withNetworkUsers`). Addresses come
 * from the list payload; the names other containers resolve it by only from inspect, where
 * `DNSNames` is its aliases plus its short ID — which says nothing, so it's left out.
 */
export function toNetworkEndpoints(
  listed: Record<string, RawEndpoint> | null | undefined,
  inspected: Record<string, RawEndpoint> | null | undefined,
  containerId: string,
): NetworkEndpoint[] {
  const short = shortId(containerId);
  const source = listed && Object.keys(listed).length > 0 ? listed : (inspected ?? {});
  return Object.entries(source)
    .map(([name, ep]) => {
      const detail = inspected?.[name];
      const names = detail?.DNSNames ?? detail?.Aliases ?? ep.DNSNames ?? ep.Aliases ?? [];
      return {
        name,
        ip: ep.IPAddress || detail?.IPAddress || '',
        gateway: ep.Gateway || detail?.Gateway || '',
        aliases: [...new Set(names)].filter((a) => a !== short),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** `container:<id>` network mode: it runs in that container's network stack. */
function sharedNetworkMode(mode: string | undefined): { container: string } | undefined {
  const target = mode?.startsWith('container:') ? mode.slice('container:'.length) : '';
  return target ? { container: target } : undefined;
}

/** `HostConfig.VolumesFrom` entries are `name[:ro|:rw]`; the container is all that's wanted. */
function volumesFromTargets(entries: unknown): string[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((e): e is string => typeof e === 'string')
    .map((e) => e.replace(/:(ro|rw)$/, ''))
    .filter((e) => e !== '');
}

export function toContainerInfo(
  raw: Dockerode.ContainerInfo,
  inspected: Dockerode.ContainerInspectInfo | null,
): ContainerInfo {
  const name = (raw.Names?.[0] ?? raw.Id).replace(/^\//, '');

  const status: ContainerStatus = VALID_STATUSES.has(raw.State as ContainerStatus)
    ? (raw.State as ContainerStatus)
    : 'exited';

  let uptime = raw.Status;
  if (inspected) {
    if (status === 'running' || status === 'paused' || status === 'restarting') {
      const startedAt = new Date(inspected.State.StartedAt);
      if (startedAt.getTime() > 0) uptime = humanUptime(startedAt);
    } else if (status === 'exited' || status === 'dead') {
      const finishedAt = new Date(inspected.State.FinishedAt);
      if (finishedAt.getTime() > 0) uptime = relativeTime(finishedAt);
    }
  }

  // The daemon sends null (not []) for these when a container publishes no ports
  // or is attached to no networks, so every access here has to tolerate null.
  const ports = toPorts(raw.Ports);
  const networks = toNetworkEndpoints(
    raw.NetworkSettings?.Networks,
    inspected?.NetworkSettings?.Networks,
    raw.Id,
  );
  // Typed as always present, but the daemon sends null for a container without labels.
  const labels = raw.Labels ?? {};
  const compose = composeInfo(labels);
  const networkMode = sharedNetworkMode(raw.HostConfig?.NetworkMode ?? inspected?.HostConfig?.NetworkMode);

  // Inspect's mounts first: the list payload leaves an anonymous volume's Source empty. Both come
  // from a Go map, so their order changes between calls — sort, or the rows reshuffle every poll.
  const mounts = (inspected?.Mounts ?? raw.Mounts ?? [])
    .map(toMountInfo)
    .sort((a, b) => a.destination.localeCompare(b.destination));

  return {
    id: raw.Id,
    name,
    image: raw.Image,
    imageId: raw.ImageID ?? '',
    // The list's `Image` turns into an ID once its name resolves to another image; inspect keeps it.
    imageName: inspected?.Config?.Image || raw.Image,
    status,
    exitCode: inspected?.State?.ExitCode ?? 0,
    uptime,
    ports,
    networks,
    mounts,
    env: inspected?.Config?.Env ?? [],
    restartPolicy: inspected?.HostConfig?.RestartPolicy?.Name ?? 'no',
    pids: inspected?.State?.Pid ?? 0,
    labels,
    ...(compose ? { compose } : {}),
    ...(networkMode ? { networkMode } : {}),
    volumesFrom: volumesFromTargets(inspected?.HostConfig?.VolumesFrom),
  };
}

export async function listContainers(): Promise<ContainerInfo[]> {
  try {
    const rawList = await dockerode.listContainers({ all: true });
    return await Promise.all(
      rawList.map(async (raw) => {
        let inspected: Dockerode.ContainerInspectInfo | null = null;
        try {
          inspected = await dockerode.getContainer(raw.Id).inspect();
        } catch {
          // Fall back to list data if inspect fails
        }
        return toContainerInfo(raw, inspected);
      }),
    );
  } catch (err) {
    throw new Error(`Failed to list containers: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toContainerStats(stats: any): ContainerStats {
  const usage: number = stats.memory_stats.usage;
  const limit: number = stats.memory_stats.limit;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blkio: any[] = stats.blkio_stats?.io_service_bytes_recursive ?? [];
  const readBytes = blkio
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((b: any) => b.op === 'Read' || b.op === 'read')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .reduce((sum: number, b: any) => sum + (b.value ?? 0), 0);
  const writeBytes = blkio
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((b: any) => b.op === 'Write' || b.op === 'write')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .reduce((sum: number, b: any) => sum + (b.value ?? 0), 0);

  return {
    cpuPercent: calcCPUPercent(stats),
    memUsageMB: usage / 1024 / 1024,
    memLimitMB: limit / 1024 / 1024,
    memPercent: limit > 0 ? (usage / limit) * 100 : 0,
    diskReadMB: readBytes / 1024 / 1024,
    diskWriteMB: writeBytes / 1024 / 1024,
  };
}

export async function fetchStats(id: string): Promise<ContainerStats> {
  try {
    const stats = await dockerode.getContainer(id).stats({ stream: false });
    return toContainerStats(stats);
  } catch (err) {
    throw new Error(
      `Failed to fetch stats for container ${id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function startContainer(id: string): Promise<void> {
  try {
    await dockerode.getContainer(id).start();
  } catch (err) {
    throw new Error(`Failed to start container ${id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function stopContainer(id: string): Promise<void> {
  try {
    await dockerode.getContainer(id).stop();
  } catch (err) {
    throw new Error(`Failed to stop container ${id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function restartContainer(id: string): Promise<void> {
  try {
    await dockerode.getContainer(id).restart();
  } catch (err) {
    throw new Error(`Failed to restart container ${id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function killContainer(id: string): Promise<void> {
  try {
    await dockerode.getContainer(id).kill();
  } catch (err) {
    throw new Error(`Failed to kill container ${id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function removeContainer(id: string): Promise<void> {
  try {
    await dockerode.getContainer(id).remove({ force: true });
  } catch (err) {
    throw new Error(`Failed to remove container ${id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function streamLogs(id: string, tail: number): Promise<NodeJS.ReadableStream> {
  try {
    return await dockerode.getContainer(id).logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail,
      timestamps: false,
    });
  } catch (err) {
    throw new Error(
      `Failed to stream logs for container ${id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
