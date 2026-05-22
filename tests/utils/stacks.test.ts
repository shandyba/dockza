import { describe, it, expect } from 'vitest';
import type { ContainerInfo, ContainerStatus } from '@models/docker';
import { NO_STACK, classifyContainer, groupIntoStacks } from '@utils/stacks';

function container(overrides: Partial<ContainerInfo> = {}): ContainerInfo {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    name: overrides.name ?? 'svc',
    image: overrides.image ?? 'alpine:latest',
    status: (overrides.status ?? 'running') as ContainerStatus,
    exitCode: overrides.exitCode ?? 0,
    uptime: overrides.uptime ?? '5m 0s',
    ports: overrides.ports ?? [],
    networks: overrides.networks ?? [],
    ip: overrides.ip ?? '',
    mounts: overrides.mounts ?? [],
    env: overrides.env ?? [],
    restartPolicy: overrides.restartPolicy ?? 'no',
    pids: overrides.pids ?? 0,
    labels: overrides.labels ?? {},
  };
}

describe('classifyContainer', () => {
  it('treats running/paused/restarting as running', () => {
    expect(classifyContainer(container({ status: 'running' }))).toBe('running');
    expect(classifyContainer(container({ status: 'paused' }))).toBe('running');
    expect(classifyContainer(container({ status: 'restarting' }))).toBe('running');
  });

  it('treats exited with non-zero code as errored', () => {
    expect(classifyContainer(container({ status: 'exited', exitCode: 137 }))).toBe('errored');
    expect(classifyContainer(container({ status: 'dead', exitCode: 1 }))).toBe('errored');
  });

  it('treats clean exit and created as stopped', () => {
    expect(classifyContainer(container({ status: 'exited', exitCode: 0 }))).toBe('stopped');
    expect(classifyContainer(container({ status: 'created' }))).toBe('stopped');
    expect(classifyContainer(container({ status: 'removing' }))).toBe('stopped');
  });
});

describe('groupIntoStacks', () => {
  it('returns an empty array for no containers', () => {
    expect(groupIntoStacks([])).toEqual([]);
  });

  it('groups by compose-project label (rule 1)', () => {
    const stacks = groupIntoStacks([
      container({ name: 'db', labels: { 'com.docker.compose.project': 'alphie' } }),
      container({ name: 'web', labels: { 'com.docker.compose.project': 'alphie' } }),
    ]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].id).toBe('alphie');
    expect(stacks[0].isCompose).toBe(true);
    expect(stacks[0].services.map((s) => s.name)).toEqual(['db', 'web']);
  });

  it('derives the stack from a _default network when no label is present (rule 2)', () => {
    const stacks = groupIntoStacks([
      container({ name: 'cache', networks: ['ndsp_default'] }),
      container({ name: 'queue', networks: ['ndsp_default'] }),
    ]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].id).toBe('ndsp');
    expect(stacks[0].isCompose).toBe(true);
  });

  it('prefers the compose label over the network suffix when both are present', () => {
    const stacks = groupIntoStacks([
      container({
        name: 'db',
        networks: ['alphie_default'],
        labels: { 'com.docker.compose.project': 'preferred' },
      }),
    ]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].id).toBe('preferred');
  });

  it('falls back to (no stack) when neither rule matches', () => {
    const stacks = groupIntoStacks([container({ name: 'standalone', networks: ['bridge'] })]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].id).toBe(NO_STACK);
    expect(stacks[0].isCompose).toBe(false);
  });

  it('orders live stacks first (by running count), then dead (by service count), with (no stack) last', () => {
    const stacks = groupIntoStacks([
      container({ name: 'a', status: 'running', labels: { 'com.docker.compose.project': 'liveA' } }),
      container({
        name: 'b',
        status: 'exited',
        exitCode: 0,
        labels: { 'com.docker.compose.project': 'liveA' },
      }),
      container({ name: 'c', status: 'running', labels: { 'com.docker.compose.project': 'liveB' } }),
      container({ name: 'd', status: 'running', labels: { 'com.docker.compose.project': 'liveB' } }),
      container({
        name: 'e',
        status: 'exited',
        exitCode: 0,
        labels: { 'com.docker.compose.project': 'deadBig' },
      }),
      container({
        name: 'f',
        status: 'exited',
        exitCode: 0,
        labels: { 'com.docker.compose.project': 'deadBig' },
      }),
      container({
        name: 'g',
        status: 'exited',
        exitCode: 0,
        labels: { 'com.docker.compose.project': 'deadSmall' },
      }),
      container({ name: 'h', status: 'exited', exitCode: 0, networks: ['bridge'] }),
    ]);

    expect(stacks.map((s) => s.id)).toEqual(['liveB', 'liveA', 'deadBig', 'deadSmall', NO_STACK]);
  });

  it('orders services within a stack: running, errored, stopped; alphabetical within each bucket', () => {
    const stack = groupIntoStacks([
      container({
        name: 'zeta',
        status: 'exited',
        exitCode: 0,
        labels: { 'com.docker.compose.project': 'mix' },
      }),
      container({
        name: 'beta',
        status: 'exited',
        exitCode: 137,
        labels: { 'com.docker.compose.project': 'mix' },
      }),
      container({ name: 'alpha', status: 'running', labels: { 'com.docker.compose.project': 'mix' } }),
      container({
        name: 'gamma',
        status: 'exited',
        exitCode: 1,
        labels: { 'com.docker.compose.project': 'mix' },
      }),
      container({ name: 'delta', status: 'running', labels: { 'com.docker.compose.project': 'mix' } }),
    ])[0];

    expect(stack.services.map((s) => s.name)).toEqual(['alpha', 'delta', 'beta', 'gamma', 'zeta']);
  });

  it('computes counts and the isLive flag', () => {
    const stack = groupIntoStacks([
      container({ status: 'running', labels: { 'com.docker.compose.project': 'app' } }),
      container({ status: 'running', labels: { 'com.docker.compose.project': 'app' } }),
      container({ status: 'exited', exitCode: 137, labels: { 'com.docker.compose.project': 'app' } }),
      container({ status: 'exited', exitCode: 0, labels: { 'com.docker.compose.project': 'app' } }),
    ])[0];

    expect(stack.counts).toEqual({ running: 2, errored: 1, stopped: 1 });
    expect(stack.isLive).toBe(true);
  });

  it('marks a stack as compose if at least one member is labeled, even when others are only network-detected', () => {
    const stacks = groupIntoStacks([
      container({ name: 'a', labels: { 'com.docker.compose.project': 'mix' } }),
      container({ name: 'b', networks: ['mix_default'] }),
    ]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].isCompose).toBe(true);
    expect(stacks[0].services.map((s) => s.name)).toEqual(['a', 'b']);
  });
});
