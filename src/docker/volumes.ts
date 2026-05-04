import { dockerode } from '@docker/client';
import type { VolumeInfo } from '@models/docker';

interface DfVolume {
  Name?: string;
  UsageData?: { Size?: number } | null;
}

interface DfPayload {
  Volumes?: DfVolume[];
}

export async function listVolumes(): Promise<VolumeInfo[]> {
  try {
    const [volumesResponse, rawContainers, dfData] = await Promise.all([
      dockerode.listVolumes(),
      dockerode.listContainers({ all: true }),
      dockerode.df().catch(() => ({ Volumes: [] }) as DfPayload),
    ]);

    const usedVolumeNames = new Set(
      rawContainers.flatMap((c) => c.Mounts.map((m) => m.Name ?? '').filter(Boolean)),
    );

    const df = dfData as DfPayload;
    const dfSizes = new Map<string, number>(
      (df.Volumes ?? [])
        .filter((v): v is DfVolume & { Name: string } => typeof v.Name === 'string')
        .map((v) => [v.Name, v.UsageData?.Size ?? -1]),
    );

    return (volumesResponse.Volumes ?? [])
      .sort((a, b) => a.Name.localeCompare(b.Name))
      .map((vol) => {
        const sizeBytes = dfSizes.get(vol.Name) ?? -1;
        const createdAt = (vol as { CreatedAt?: string }).CreatedAt;
        return {
          name: vol.Name,
          driver: vol.Driver,
          mountpoint: vol.Mountpoint,
          created: createdAt ? new Date(createdAt) : new Date(0),
          sizeMB: sizeBytes > 0 ? sizeBytes / 1024 / 1024 : 0,
          inUse: usedVolumeNames.has(vol.Name),
        };
      });
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
