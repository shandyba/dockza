import type { ContainerInfo, ImageInfo, NetworkEndpoint, NetworkInfo, VolumeInfo } from '@models/docker';

/** A container with every field neutral; tests override what they look at. */
export function makeContainer(extra: Partial<ContainerInfo> = {}): ContainerInfo {
  return {
    id: 'c1',
    name: 'svc',
    image: 'img',
    imageId: 'sha256:img',
    imageName: 'img',
    status: 'running',
    exitCode: 0,
    uptime: '1m',
    ports: [],
    networks: [],
    mounts: [],
    env: [],
    restartPolicy: 'no',
    pids: 1,
    labels: {},
    volumesFrom: [],
    ...extra,
  };
}

/** An endpoint on network `name`, as a stopped container has one (no address) unless given. */
export function endpoint(name: string, extra: Partial<NetworkEndpoint> = {}): NetworkEndpoint {
  return { name, ip: '', gateway: '', aliases: [], ...extra };
}

export function makeImage(id: string, tags: string[], extra: Partial<ImageInfo> = {}): ImageInfo {
  const first = tags[0] ?? '<none>:<none>';
  const at = first.lastIndexOf(':');
  return {
    id,
    tags,
    repository: first.slice(0, at),
    tag: first.slice(at + 1),
    sizeMB: 100,
    created: new Date(0),
    users: [],
    inUse: false,
    supersededBy: [],
    ...extra,
  };
}

export function makeVolume(name: string, extra: Partial<VolumeInfo> = {}): VolumeInfo {
  return {
    name,
    driver: 'local',
    mountpoint: `/var/lib/docker/volumes/${name}/_data`,
    created: new Date(0),
    sizeMB: 0,
    labels: {},
    anonymous: false,
    users: [],
    inUse: false,
    ...extra,
  };
}

export function makeNetwork(name: string, extra: Partial<NetworkInfo> = {}): NetworkInfo {
  return {
    id: `${name}-id`,
    name,
    driver: 'bridge',
    scope: 'local',
    created: new Date(0),
    internal: false,
    subnets: [],
    gateways: [],
    labels: {},
    users: [],
    containerCount: 0,
    inUse: false,
    builtin: false,
    ...extra,
  };
}
