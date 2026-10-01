import type Dockerode from 'dockerode';
import { dockerode } from '@docker/client';
import type { VolumeInfo } from '@models/docker';
import { COMPOSE_PROJECT_LABEL, COMPOSE_VOLUME_LABEL } from '@utils/compose';
import { isAnonymousVolume } from '@utils/mounts';

interface DfVolume {
  Name?: string;
  UsageData?: { Size?: number } | null;
}

interface DfPayload {
  Volumes?: DfVolume[];
}

/**
 * A volume as the daemon lists it. `users` / `inUse` start empty: who mounts a volume comes from
 * the container listing, which App owns and joins in (`withUsers`).
 */
export function toVolumeInfo(raw: Dockerode.VolumeInspectInfo, sizeBytes: number): VolumeInfo {
  // Typed as always present, but the daemon sends null for a volume without labels.
  const labels = raw.Labels ?? {};
  const createdAt = (raw as { CreatedAt?: string }).CreatedAt;
  const stack = labels[COMPOSE_PROJECT_LABEL];
  const composeVolume = labels[COMPOSE_VOLUME_LABEL];
  return {
    name: raw.Name,
    driver: raw.Driver,
    mountpoint: raw.Mountpoint,
    created: createdAt ? new Date(createdAt) : new Date(0),
    sizeMB: sizeBytes > 0 ? sizeBytes / 1024 / 1024 : 0,
    labels,
    anonymous: isAnonymousVolume(raw.Name, labels),
    ...(stack ? { stack } : {}),
    ...(composeVolume ? { composeVolume } : {}),
    users: [],
    inUse: false,
  };
}

export async function listVolumes(): Promise<VolumeInfo[]> {
  try {
    const [volumesResponse, dfData] = await Promise.all([
      dockerode.listVolumes(),
      dockerode.df().catch(() => ({ Volumes: [] }) as DfPayload),
    ]);

    const df = dfData as DfPayload;
    const dfSizes = new Map<string, number>(
      (df.Volumes ?? [])
        .filter((v): v is DfVolume & { Name: string } => typeof v.Name === 'string')
        .map((v) => [v.Name, v.UsageData?.Size ?? -1]),
    );

    return (volumesResponse.Volumes ?? [])
      .sort((a, b) => a.Name.localeCompare(b.Name))
      .map((vol) => toVolumeInfo(vol, dfSizes.get(vol.Name) ?? -1));
  } catch (err) {
    throw new Error(`Failed to list volumes: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function removeVolume(name: string): Promise<void> {
  try {
    await dockerode.getVolume(name).remove();
  } catch (err) {
    throw new Error(`Failed to remove volume ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
