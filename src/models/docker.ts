export type MountType = 'bind' | 'volume' | 'tmpfs' | 'image' | 'npipe' | 'cluster';

export interface MountInfo {
  /** Volume name, named or anonymous. Set only on `volume` mounts. */
  name?: string;
  /** Volume driver. Set only on `volume` mounts. */
  driver?: string;
  /** Path on the daemon's host; for a volume, its mountpoint. */
  source: string;
  destination: string;
  mode: string;
  rw: boolean;
  type: MountType;
}

export type ContainerStatus =
  | 'running'
  | 'paused'
  | 'exited'
  | 'restarting'
  | 'dead'
  | 'created'
  | 'removing';

/** A container's attachment to one network, keyed by the network's name. */
export interface NetworkEndpoint {
  name: string;
  /** Empty while the container is stopped. */
  ip: string;
  gateway: string;
  /** Names other containers on the network resolve it by, without its short ID. */
  aliases: string[];
}

/** One port a container exposes, and where it is published on the host (if it is). */
export interface PortInfo {
  /** Host address it is published on; absent when unpublished. */
  ip?: string;
  publicPort?: number;
  privatePort: number;
  /** `tcp`, `udp` or `sctp`. */
  type: string;
}

/** What compose's labels say about a container it created. */
export interface ComposeInfo {
  project: string;
  service: string;
  /** The compose file(s) the project was brought up from. */
  configFiles: string[];
  workingDir?: string;
  /** Services this one names under `depends_on`. */
  dependsOn: string[];
  /** Created by `docker compose run`, not `up`. */
  oneoff: boolean;
}

/** A newer image carries the tag this container was created from. */
export interface OutdatedImage {
  /** The tag, as the image now carrying it lists it (`postgres:18`). */
  tag: string;
  currentImageId: string;
}

/** How one container relates to another: compose ordering, a shared network stack, borrowed volumes. */
export type ContainerRelation =
  | 'depends-on'
  | 'needed-by'
  | 'network-of'
  | 'shares-network'
  | 'volumes-from'
  | 'lends-volumes';

export interface ContainerLink {
  relation: ContainerRelation;
  /** The other container; absent when the name it was given matches none (a removed service). */
  container?: ContainerUser;
  /** What the relation named it by: a compose service, a container name, or an ID. */
  target: string;
  /** The compose service the `depends_on` is about (`depends-on` / `needed-by` only). */
  service?: string;
}

export interface ContainerInfo {
  id: string;
  name: string;
  /** As listed: the name it was created from, or an ID once that name moved to another image. */
  image: string;
  /** The exact image it runs. */
  imageId: string;
  /** The name it was created from, always (inspect's `Config.Image`): which tag it follows. */
  imageName: string;
  status: ContainerStatus;
  exitCode: number;
  uptime: string;
  ports: PortInfo[];
  networks: NetworkEndpoint[];
  mounts: MountInfo[];
  env: string[];
  restartPolicy: string;
  pids: number;
  labels: Record<string, string>;
  compose?: ComposeInfo;
  /** Runs in another container's network stack (`--network container:<id>`). */
  networkMode?: { container: string };
  /** Containers (by name or ID) whose volumes it mounts too. */
  volumesFrom: string[];
  /** Joined in by App from the image listing. */
  outdated?: OutdatedImage;
  /** Joined in by App: every other container it relates to, both directions. */
  links?: ContainerLink[];
}

/** A container, seen from something it uses: enough to name it, link to it and show its status. */
export type ContainerUser = Pick<ContainerInfo, 'id' | 'name' | 'status' | 'exitCode'>;

export type ImageUser = ContainerUser;

export interface ImageInfo {
  id: string;
  /** Every `repo:tag` it carries, in the daemon's (sorted) order. Empty for a dangling image. */
  tags: string[];
  /** The first tag's halves, or `<none>`. */
  repository: string;
  tag: string;
  sizeMB: number;
  created: Date;
  /** Containers created from it, running or stopped. Joined in by App from the container listing. */
  users: ImageUser[];
  inUse: boolean;
  /** Tags its users were created from that now name a newer image. Joined in by App. */
  supersededBy: string[];
}

/** A container mounting a volume, seen from the volume's side. */
export interface VolumeUser extends ContainerUser {
  destination: string;
  rw: boolean;
}

/** An image whose `VOLUME` an anonymous volume was created for. */
export interface VolumeProvenance {
  imageId: string;
  /** How to name the image: its first tag, or the name its container was created from. */
  image: string;
  path: string;
}

export interface VolumeInfo {
  name: string;
  driver: string;
  mountpoint: string;
  created: Date;
  sizeMB: number;
  labels: Record<string, string>;
  anonymous: boolean;
  /** Compose project that created it (`com.docker.compose.project`). */
  stack?: string;
  /** Its key under that project's `volumes:` (`com.docker.compose.volume`). */
  composeVolume?: string;
  /** Containers mounting it, running or stopped. Joined in by App from the container listing. */
  users: VolumeUser[];
  inUse: boolean;
  /** Unused, and its compose project has no containers left. Joined in by App. */
  orphaned?: boolean;
  /** For an anonymous volume: the image `VOLUME`s it was made for. Joined in by App. */
  provenance?: VolumeProvenance[];
}

/** A container attached to a network, seen from the network's side. */
export interface NetworkUser extends ContainerUser {
  ip: string;
  aliases: string[];
}

export interface NetworkInfo {
  id: string;
  name: string;
  driver: string;
  scope: string;
  created: Date;
  internal: boolean;
  /** From its IPAM config; empty for `host` and `none`. */
  subnets: string[];
  gateways: string[];
  labels: Record<string, string>;
  /** Compose project that created it (`com.docker.compose.project`). */
  stack?: string;
  /** Its key under that project's `networks:` (`com.docker.compose.network`). */
  composeNetwork?: string;
  /** Containers attached to it, running or stopped. Joined in by App from the container listing. */
  users: NetworkUser[];
  containerCount: number;
  inUse: boolean;
  builtin: boolean;
  /** Unused, and its compose project has no containers left. Joined in by App. */
  orphaned?: boolean;
}

export interface ContainerStats {
  cpuPercent: number;
  memUsageMB: number;
  memLimitMB: number;
  memPercent: number;
  diskReadMB: number;
  diskWriteMB: number;
}
