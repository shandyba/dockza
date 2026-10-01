import type { ContainerInfo, MountInfo } from '@models/docker';

const ANONYMOUS_LABEL = 'com.docker.volume.anonymous';
/** What the daemon names a volume nobody named: 64 hex digits, like a container ID. */
const GENERATED_NAME = /^[0-9a-f]{64}$/;
/** Where Docker Desktop's VM sees the host's file system. */
const DESKTOP_HOST_ROOT = '/host_mnt';

/**
 * An anonymous volume: one the daemon named because nobody else did. Recent daemons label it (with an
 * empty value, so test presence, not truth); older ones only leave the generated name to go by.
 */
export function isAnonymousVolume(name: string, labels: Record<string, string> = {}): boolean {
  return Object.hasOwn(labels, ANONYMOUS_LABEL) || GENERATED_NAME.test(name);
}

/** The anonymous volumes they mount, once each: what `docker rm -v` deletes along with them. */
export function anonymousVolumes(containers: Pick<ContainerInfo, 'mounts'>[]): string[] {
  const names = containers.flatMap((c) =>
    c.mounts.flatMap((m) => (m.type === 'volume' && m.name && isAnonymousVolume(m.name) ? [m.name] : [])),
  );
  return [...new Set(names)];
}

/**
 * A bind source as the host knows it. Docker Desktop reports `/tmp/x` as `/host_mnt/private/tmp/x`,
 * which only exists inside its VM; anywhere else the source already is the host path.
 */
export function hostPath(source: string): string {
  if (source === DESKTOP_HOST_ROOT) return '/';
  return source.startsWith(`${DESKTOP_HOST_ROOT}/`) ? source.slice(DESKTOP_HOST_ROOT.length) : source;
}

/** Where a mount comes from, in one word or path: the volume's name, the host path, or the type. */
export function mountOrigin(m: MountInfo): string {
  if (m.type === 'volume') return m.name ?? m.source;
  if (m.type === 'bind') return hostPath(m.source);
  return m.source || m.type;
}

/** The mount as `docker run -v` takes it (`name:/dest`, `/host:/dest:ro`); `null` where `-v` can't express it. */
export function mountSpec(m: MountInfo): string | null {
  const from = m.type === 'volume' ? m.name : m.type === 'bind' ? hostPath(m.source) : undefined;
  if (!from || !m.destination) return null;
  return `${from}:${m.destination}${m.rw ? '' : ':ro'}`;
}
