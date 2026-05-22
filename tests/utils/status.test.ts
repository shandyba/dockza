import { describe, it, expect } from 'vitest';
import {
  ACTIVE_STATUSES,
  isActive,
  statusDot,
  statusLabel,
  colorByStatus,
  cpuColor,
  memColor,
} from '@utils/status';
import { t } from '@theme';
import type { ContainerStatus } from '@models/docker';

describe('ACTIVE_STATUSES / isActive', () => {
  it('marks running, paused, restarting as active', () => {
    expect(isActive('running')).toBe(true);
    expect(isActive('paused')).toBe(true);
    expect(isActive('restarting')).toBe(true);
  });

  it('marks exited, dead, created, removing as inactive', () => {
    const inactive: ContainerStatus[] = ['exited', 'dead', 'created', 'removing'];
    for (const s of inactive) expect(isActive(s)).toBe(false);
  });

  it('ACTIVE_STATUSES set matches isActive predicate', () => {
    expect(ACTIVE_STATUSES.has('running')).toBe(true);
    expect(ACTIVE_STATUSES.has('exited')).toBe(false);
  });
});

describe('statusLabel', () => {
  it('formats exited with exit code', () => {
    expect(statusLabel({ status: 'exited', exitCode: 0 })).toBe('exited(0)');
    expect(statusLabel({ status: 'exited', exitCode: 137 })).toBe('exited(137)');
  });

  it('passes through other statuses unchanged', () => {
    expect(statusLabel({ status: 'running', exitCode: 0 })).toBe('running');
    expect(statusLabel({ status: 'paused', exitCode: 0 })).toBe('paused');
    expect(statusLabel({ status: 'dead', exitCode: 1 })).toBe('dead');
  });
});

describe('statusDot', () => {
  it('uses green for running', () => {
    expect(statusDot({ status: 'running', exitCode: 0 })).toBe(t.green('●'));
  });

  it('uses yellow for paused', () => {
    expect(statusDot({ status: 'paused', exitCode: 0 })).toBe(t.yellow('●'));
  });

  it('uses orange for restarting', () => {
    expect(statusDot({ status: 'restarting', exitCode: 0 })).toBe(t.orange('●'));
  });

  it('dims exited(0) but reds exited(N)', () => {
    expect(statusDot({ status: 'exited', exitCode: 0 })).toBe(t.comment('●'));
    expect(statusDot({ status: 'exited', exitCode: 1 })).toBe(t.red('●'));
  });

  it('uses red for dead', () => {
    expect(statusDot({ status: 'dead', exitCode: 0 })).toBe(t.red('●'));
  });
});

describe('colorByStatus', () => {
  it('applies status-appropriate color to arbitrary text', () => {
    expect(colorByStatus({ status: 'running', exitCode: 0 }, 'hello')).toBe(t.green('hello'));
    expect(colorByStatus({ status: 'paused', exitCode: 0 }, 'x')).toBe(t.yellow('x'));
    expect(colorByStatus({ status: 'restarting', exitCode: 0 }, 'x')).toBe(t.orange('x'));
    expect(colorByStatus({ status: 'exited', exitCode: 0 }, 'x')).toBe(t.comment('x'));
    expect(colorByStatus({ status: 'exited', exitCode: 1 }, 'x')).toBe(t.red('x'));
    expect(colorByStatus({ status: 'dead', exitCode: 0 }, 'x')).toBe(t.red('x'));
    expect(colorByStatus({ status: 'created', exitCode: 0 }, 'x')).toBe(t.comment('x'));
  });
});

describe('cpuColor', () => {
  it('returns purple under 50%', () => {
    expect(cpuColor(0)).toBe(t.purple);
    expect(cpuColor(49.9)).toBe(t.purple);
  });

  it('returns orange between 50 and 80', () => {
    expect(cpuColor(50)).toBe(t.orange);
    expect(cpuColor(79.9)).toBe(t.orange);
  });

  it('returns red at or above 80', () => {
    expect(cpuColor(80)).toBe(t.red);
    expect(cpuColor(99.5)).toBe(t.red);
  });
});

describe('memColor', () => {
  it('returns cyan under 60%', () => {
    expect(memColor(0)).toBe(t.cyan);
    expect(memColor(59.9)).toBe(t.cyan);
  });

  it('returns orange between 60 and 80', () => {
    expect(memColor(60)).toBe(t.orange);
    expect(memColor(79.9)).toBe(t.orange);
  });

  it('returns red at or above 80', () => {
    expect(memColor(80)).toBe(t.red);
    expect(memColor(99.5)).toBe(t.red);
  });
});
