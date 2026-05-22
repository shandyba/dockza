import { describe, it, expect } from 'vitest';
import { calcCPUPercent } from '@utils/stats';

function statsPayload(opts: {
  totalUsage: number;
  preTotalUsage: number;
  systemUsage: number;
  preSystemUsage: number;
  onlineCpus?: number;
  percpu?: number[];
}): any {
  return {
    cpu_stats: {
      cpu_usage: {
        total_usage: opts.totalUsage,
        percpu_usage: opts.percpu,
      },
      system_cpu_usage: opts.systemUsage,
      online_cpus: opts.onlineCpus,
    },
    precpu_stats: {
      cpu_usage: { total_usage: opts.preTotalUsage },
      system_cpu_usage: opts.preSystemUsage,
    },
  };
}

describe('calcCPUPercent', () => {
  it('computes the standard Docker CPU percentage', () => {
    const stats = statsPayload({
      totalUsage: 1100,
      preTotalUsage: 1000,
      systemUsage: 11000,
      preSystemUsage: 10000,
      onlineCpus: 1,
    });
    expect(calcCPUPercent(stats)).toBe(10);
  });

  it('multiplies by online_cpus', () => {
    const stats = statsPayload({
      totalUsage: 1100,
      preTotalUsage: 1000,
      systemUsage: 11000,
      preSystemUsage: 10000,
      onlineCpus: 4,
    });
    expect(calcCPUPercent(stats)).toBe(40);
  });

  it('falls back to percpu_usage.length when online_cpus is missing', () => {
    const stats = statsPayload({
      totalUsage: 1100,
      preTotalUsage: 1000,
      systemUsage: 11000,
      preSystemUsage: 10000,
      percpu: [0, 0, 0, 0, 0, 0, 0, 0], // 8 cpus
    });
    expect(calcCPUPercent(stats)).toBe(80);
  });

  it('falls back to 1 cpu when neither online_cpus nor percpu_usage are set', () => {
    const stats = statsPayload({
      totalUsage: 1100,
      preTotalUsage: 1000,
      systemUsage: 11000,
      preSystemUsage: 10000,
    });
    expect(calcCPUPercent(stats)).toBe(10);
  });

  it('returns 0 when sysDelta is 0 (no divide-by-zero)', () => {
    const stats = statsPayload({
      totalUsage: 1100,
      preTotalUsage: 1000,
      systemUsage: 10000,
      preSystemUsage: 10000,
      onlineCpus: 1,
    });
    expect(calcCPUPercent(stats)).toBe(0);
  });

  it('returns 0 when sysDelta is negative (clock skew or first sample)', () => {
    const stats = statsPayload({
      totalUsage: 1100,
      preTotalUsage: 1000,
      systemUsage: 9000,
      preSystemUsage: 10000,
      onlineCpus: 1,
    });
    expect(calcCPUPercent(stats)).toBe(0);
  });
});
