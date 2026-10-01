import {
  killContainer,
  removeContainer,
  restartContainer,
  startContainer,
  stopContainer,
} from '@docker/containers';
import { removeNetwork } from '@docker/networks';
import { removeVolume } from '@docker/volumes';

/** A container a stack action works on: its ID to act, its name to report a failure by. */
export interface StackMember {
  id: string;
  name: string;
}

/** What `downStack` removes. Containers are stopped in `stop` order first, as compose does. */
export interface StackDownTargets {
  /** The running ones, in the order to stop them (dependents first). */
  stop: StackMember[][];
  containers: StackMember[];
  networks: StackMember[];
  /** Named volumes, deleted only with `volumes`. */
  volumes: string[];
}

interface Failure {
  name: string;
  reason: string;
}

const reasonOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Runs `act` on every target, a wave at a time and each wave in parallel. A failure doesn't stop
 * the rest — a half-stopped stack is worse than a stack with one stubborn container.
 */
async function inWaves<T>(
  waves: T[][],
  act: (t: T) => Promise<void>,
  nameOf: (t: T) => string,
): Promise<Failure[]> {
  const failures: Failure[] = [];
  for (const wave of waves) {
    const results = await Promise.allSettled(wave.map((t) => act(t)));
    results.forEach((r, i) => {
      if (r.status === 'rejected') failures.push({ name: nameOf(wave[i]), reason: reasonOf(r.reason) });
    });
  }
  return failures;
}

const memberName = (m: StackMember): string => m.name;

/** One error for everything that failed: which ones, and the first reason (the rest are usually alike). */
function throwIfFailed(project: string, verb: string, failures: Failure[]): void {
  if (failures.length === 0) return;
  const names = [...new Set(failures.map((f) => f.name))].join(', ');
  throw new Error(`Stack ${project}: couldn't ${verb} ${names} — ${failures[0].reason}`);
}

export async function stopStack(project: string, waves: StackMember[][]): Promise<void> {
  throwIfFailed(project, 'stop', await inWaves(waves, (m) => stopContainer(m.id), memberName));
}

export async function startStack(project: string, waves: StackMember[][]): Promise<void> {
  throwIfFailed(project, 'start', await inWaves(waves, (m) => startContainer(m.id), memberName));
}

export async function restartStack(project: string, waves: StackMember[][]): Promise<void> {
  throwIfFailed(project, 'restart', await inWaves(waves, (m) => restartContainer(m.id), memberName));
}

export async function killStack(project: string, members: StackMember[]): Promise<void> {
  throwIfFailed(project, 'kill', await inWaves([members], (m) => killContainer(m.id), memberName));
}

/**
 * `docker compose down`: stop the running containers gracefully, remove every container, then the
 * networks. With `volumes` (`down -v`) the containers' anonymous volumes go with them, and then
 * the named ones. Each step runs even when an earlier one partly failed: whatever can go, goes.
 */
export async function downStack(
  project: string,
  targets: StackDownTargets,
  { volumes = false }: { volumes?: boolean } = {},
): Promise<void> {
  const failures = [
    ...(await inWaves(targets.stop, (m) => stopContainer(m.id), memberName)),
    ...(await inWaves([targets.containers], (m) => removeContainer(m.id, { volumes }), memberName)),
    ...(await inWaves([targets.networks], (n) => removeNetwork(n.id), memberName)),
    ...(volumes ? await inWaves([targets.volumes], removeVolume, (name) => name) : []),
  ];
  throwIfFailed(project, 'remove', failures);
}
