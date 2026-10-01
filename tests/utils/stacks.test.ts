import { describe, it, expect } from 'vitest';
import type { ComposeInfo, ContainerInfo } from '@models/docker';
import {
  NO_STACK,
  classifyContainer,
  groupIntoStacks,
  serviceContainers,
  stackCompose,
  stackDownPlan,
  stackResources,
  startWaves,
} from '@utils/stacks';
import { endpoint, makeContainer, makeNetwork, makeVolume } from '../fixtures';

function container(overrides: Partial<ContainerInfo> = {}): ContainerInfo {
  return makeContainer({
    id: Math.random().toString(36).slice(2),
    name: 'svc',
    image: 'alpine:latest',
    uptime: '5m 0s',
    pids: 0,
    ...overrides,
  });
}

/** Attached to these networks, by name. */
const on = (...names: string[]) => names.map((n) => endpoint(n));

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
      container({ name: 'cache', networks: on('ndsp_default') }),
      container({ name: 'queue', networks: on('ndsp_default') }),
    ]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].id).toBe('ndsp');
    expect(stacks[0].isCompose).toBe(true);
  });

  it('prefers the compose label over the network suffix when both are present', () => {
    const stacks = groupIntoStacks([
      container({
        name: 'db',
        networks: on('alphie_default'),
        labels: { 'com.docker.compose.project': 'preferred' },
      }),
    ]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].id).toBe('preferred');
  });

  it('falls back to (no stack) when neither rule matches', () => {
    const stacks = groupIntoStacks([container({ name: 'standalone', networks: on('bridge') })]);
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
      container({ name: 'h', status: 'exited', exitCode: 0, networks: on('bridge') }),
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
      container({ name: 'b', networks: on('mix_default') }),
    ]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].isCompose).toBe(true);
    expect(stacks[0].services.map((s) => s.name)).toEqual(['a', 'b']);
  });
});

describe('stackCompose', () => {
  const compose = (configFiles: string[], workingDir?: string) => ({
    project: 'p',
    service: 's',
    configFiles,
    ...(workingDir ? { workingDir } : {}),
    dependsOn: [],
    oneoff: false,
  });

  it("reads the compose files and working dir from its services' labels", () => {
    const [stack] = groupIntoStacks([
      container({ name: 'a', labels: { 'com.docker.compose.project': 'p' } }),
      container({
        name: 'b',
        labels: { 'com.docker.compose.project': 'p' },
        compose: compose(['/srv/p/compose.yaml'], '/srv/p'),
      }),
    ]);
    expect(stackCompose(stack)).toEqual({ configFiles: ['/srv/p/compose.yaml'], workingDir: '/srv/p' });
  });

  it('is empty for a stack compose did not label', () => {
    const [stack] = groupIntoStacks([container({ networks: on('legacy_default') })]);
    expect(stackCompose(stack)).toEqual({ configFiles: [] });
  });
});

/** A service of compose project `p`. */
function service(name: string, dependsOn: string[] = [], extra: Partial<ComposeInfo> = {}): ContainerInfo {
  return container({
    id: `c-${name}`,
    name: `p-${name}-1`,
    labels: { 'com.docker.compose.project': 'p' },
    compose: { project: 'p', service: name, configFiles: [], dependsOn, oneoff: false, ...extra },
  });
}

const names = (waves: ContainerInfo[][]) => waves.map((w) => w.map((c) => c.compose?.service ?? c.name));

describe('startWaves', () => {
  it('starts dependencies first: db, then api, then web', () => {
    const waves = startWaves([service('web', ['api']), service('api', ['db']), service('db')]);
    expect(names(waves)).toEqual([['db'], ['api'], ['web']]);
  });

  it('starts what nothing orders together, and containers compose did not make in one wave', () => {
    expect(names(startWaves([service('a'), service('b')]))).toEqual([['a', 'b']]);
    expect(names(startWaves([container({ name: 'x' }), container({ name: 'y' })]))).toEqual([['x', 'y']]);
  });

  it('ignores a dependency that is not among them', () => {
    expect(names(startWaves([service('api', ['db'])]))).toEqual([['api']]);
  });

  it('starts a cycle together instead of hanging', () => {
    const waves = startWaves([service('base'), service('a', ['b', 'base']), service('b', ['a'])]);
    expect(names(waves)).toEqual([['base'], ['a', 'b']]);
  });

  it('keeps replicas of one service in one wave', () => {
    const r1 = service('worker', ['db']);
    const r2 = { ...service('worker', ['db']), id: 'c-worker-2' };
    expect(startWaves([r1, r2, service('db')]).map((w) => w.length)).toEqual([1, 2]);
  });
});

describe('serviceContainers', () => {
  it('leaves out the containers `compose run` left', () => {
    const [stack] = groupIntoStacks([service('api'), service('api-run', [], { oneoff: true })]);
    expect(serviceContainers(stack).map((c) => c.name)).toEqual(['p-api-1']);
  });
});

describe('stackResources', () => {
  it("picks a stack's labelled volumes and networks, and its default network", () => {
    const all = {
      volumes: [makeVolume('p_data', { stack: 'p' }), makeVolume('q_data', { stack: 'q' })],
      networks: [makeNetwork('p_default'), makeNetwork('p_back', { stack: 'p' }), makeNetwork('bridge')],
    };
    const own = stackResources({ id: 'p' }, all);
    expect(own.volumes.map((v) => v.name)).toEqual(['p_data']);
    expect(own.networks.map((n) => n.name)).toEqual(['p_default', 'p_back']);
  });
});

describe('stackDownPlan', () => {
  const ANON = 'e'.repeat(64);
  const db = {
    ...service('db'),
    mounts: [{ type: 'volume' as const, name: ANON, source: '', destination: '/d', mode: '', rw: true }],
  };
  const api = service('api', ['db']);
  const outsider = container({ id: 'c-out', name: 'outsider' });
  const userOf = (c: ContainerInfo) => ({ id: c.id, name: c.name, status: c.status, exitCode: 0 });

  it('removes every container and its own networks and volumes; keeps what others use', () => {
    const [stack] = groupIntoStacks([db, api]);
    const plan = stackDownPlan(stack, {
      volumes: [
        makeVolume('p_data', { stack: 'p', users: [{ ...userOf(db), destination: '/x', rw: true }] }),
        makeVolume('p_cache', { stack: 'p' }),
        makeVolume('p_shared', { stack: 'p', users: [{ ...userOf(outsider), destination: '/y', rw: true }] }),
      ],
      networks: [
        makeNetwork('p_default', { users: [{ ...userOf(db), ip: '', aliases: [] }] }),
        makeNetwork('p_front', { stack: 'p', users: [{ ...userOf(outsider), ip: '', aliases: [] }] }),
      ],
    });
    expect(plan.containers.map((c) => c.name).sort()).toEqual(['p-api-1', 'p-db-1']);
    expect(plan.networks.map((n) => n.name)).toEqual(['p_default']);
    expect(plan.volumes.map((v) => v.name)).toEqual(['p_data', 'p_cache']);
    expect(plan.anonymous).toEqual([ANON]);
    expect(plan.shared).toBe(2);
  });
});
