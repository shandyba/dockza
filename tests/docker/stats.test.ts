import { describe, it, expect } from 'vitest';
import { toContainerStats } from '@docker/containers';

function statsPayload(overrides: {
  totalUsage?: number;
  preTotalUsage?: number;
  systemUsage?: number;
  preSystemUsage?: number;
  onlineCpus?: number;
  memUsage?: number;
  memLimit?: number;
  blkio?: { op: string; value: number }[];
}): any {
  return {
    cpu_stats: {
      cpu_usage: { total_usage: overrides.totalUsage ?? 0 },
      system_cpu_usage: overrides.systemUsage ?? 0,
      online_cpus: overrides.onlineCpus ?? 1,
    },
    precpu_stats: {
      cpu_usage: { total_usage: overrides.preTotalUsage ?? 0 },
      system_cpu_usage: overrides.preSystemUsage ?? 0,
    },
    memory_stats: {
      usage: overrides.memUsage ?? 0,
      limit: overrides.memLimit ?? 1,
    },
    blkio_stats: {
      io_service_bytes_recursive: overrides.blkio ?? [],
    },
  };
}

describe('toContainerStats', () => {
  it('converts memory bytes to MiB', () => {
    const stats = toContainerStats(
      statsPayload({ memUsage: 512 * 1024 * 1024, memLimit: 1024 * 1024 * 1024 }),
    );
    expect(stats.memUsageMB).toBe(512);
    expect(stats.memLimitMB).toBe(1024);
    expect(stats.memPercent).toBeCloseTo(50, 5);
  });

  it('returns 0 memPercent when limit is 0 (no divide-by-zero)', () => {
    const stats = toContainerStats(statsPayload({ memUsage: 100, memLimit: 0 }));
    expect(stats.memPercent).toBe(0);
  });

  it('sums blkio read/write bytes (case-insensitive on op)', () => {
    const stats = toContainerStats(
      statsPayload({
        blkio: [
          { op: 'Read', value: 1024 * 1024 },
          { op: 'read', value: 1024 * 1024 },
          { op: 'Write', value: 2 * 1024 * 1024 },
          { op: 'Async', value: 999 },
        ],
      }),
    );
    expect(stats.diskReadMB).toBe(2);
    expect(stats.diskWriteMB).toBe(2);
  });

  it('handles missing blkio_stats gracefully', () => {
    const raw: any = statsPayload({});
    raw.blkio_stats = undefined;
    const stats = toContainerStats(raw);
    expect(stats.diskReadMB).toBe(0);
    expect(stats.diskWriteMB).toBe(0);
  });

  it('computes cpuPercent via calcCPUPercent', () => {
    const stats = toContainerStats(
      statsPayload({
        totalUsage: 2000,
        preTotalUsage: 1000,
        systemUsage: 20000,
        preSystemUsage: 10000,
        onlineCpus: 1,
      }),
    );
    expect(stats.cpuPercent).toBe(10);
  });
});
