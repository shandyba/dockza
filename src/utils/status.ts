import { t } from '@theme';
import type { ContainerInfo, ContainerStatus } from '@models/docker';

type ColorFn = (s: string) => string;
type StatusSubset = Pick<ContainerInfo, 'status' | 'exitCode'>;

export const ACTIVE_STATUSES = new Set<ContainerStatus>(['running', 'paused', 'restarting']);

export function isActive(status: ContainerStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

export function statusDot(c: StatusSubset): string {
  switch (c.status) {
    case 'running':
      return t.green('●');
    case 'paused':
      return t.yellow('●');
    case 'restarting':
      return t.orange('●');
    case 'exited':
      return c.exitCode === 0 ? t.comment('●') : t.red('●');
    case 'dead':
      return t.red('●');
    default:
      return t.comment('●');
  }
}

export function statusLabel(c: StatusSubset): string {
  switch (c.status) {
    case 'exited':
      return c.exitCode === 0 ? 'exited(0)' : `exited(${c.exitCode})`;
    default:
      return c.status;
  }
}

export function colorByStatus(c: StatusSubset, text: string): string {
  switch (c.status) {
    case 'running':
      return t.green(text);
    case 'paused':
      return t.yellow(text);
    case 'restarting':
      return t.orange(text);
    case 'exited':
      return c.exitCode === 0 ? t.comment(text) : t.red(text);
    case 'dead':
      return t.red(text);
    default:
      return t.comment(text);
  }
}

export function cpuColor(cpu: number): ColorFn {
  if (cpu >= 80) return t.red;
  if (cpu >= 50) return t.orange;
  return t.purple;
}

export function memColor(mem: number): ColorFn {
  if (mem >= 80) return t.red;
  if (mem >= 60) return t.orange;
  return t.cyan;
}

export function formatCpuCell(c: StatusSubset, cpu?: number): string {
  if (!isActive(c.status) || cpu === undefined) return t.faint('—');
  return cpuColor(cpu)(`${cpu.toFixed(1)}%`);
}

export function formatMemCell(c: StatusSubset, mem?: number): string {
  if (!isActive(c.status) || mem === undefined) return t.faint('—');
  return memColor(mem)(`${mem.toFixed(1)}%`);
}
