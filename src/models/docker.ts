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

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: ContainerStatus;
  exitCode: number;
  uptime: string;
  ports: string[];
  networks: string[];
  ip: string;
  mounts: MountInfo[];
  env: string[];
  restartPolicy: string;
  pids: number;
  labels: Record<string, string>;
}

export interface ImageInfo {
  id: string;
  repository: string;
  tag: string;
  sizeMB: number;
  created: Date;
  inUse: boolean;
}

/** A container mounting a volume, seen from the volume's side. */
export interface VolumeUser extends Pick<ContainerInfo, 'id' | 'name' | 'status' | 'exitCode'> {
  destination: string;
  rw: boolean;
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
}

export interface NetworkInfo {
  id: string;
  name: string;
  driver: string;
  scope: string;
  created: Date;
  containerCount: number;
  inUse: boolean;
  builtin: boolean;
}

export interface ContainerStats {
  cpuPercent: number;
  memUsageMB: number;
  memLimitMB: number;
  memPercent: number;
  diskReadMB: number;
  diskWriteMB: number;
}
