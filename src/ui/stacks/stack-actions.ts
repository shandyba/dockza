import {
  downStack,
  killStack,
  restartStack,
  startStack,
  stopStack,
  type StackDownTargets,
  type StackMember,
} from '@docker/stacks';
import type { ContainerInfo } from '@models/docker';
import { isActive } from '@utils/status';
import {
  serviceContainers,
  stackDownPlan,
  startWaves,
  type Stack,
  type StackDownPlan,
  type StackResources,
} from '@utils/stacks';
import type { ActionChoice, ActionDialog } from '@ui/containers/confirm-dialog';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

const members = (cs: Array<Pick<ContainerInfo, 'id' | 'name'>>): StackMember[] =>
  cs.map(({ id, name }) => ({ id, name }));

/** Dependencies first, the way compose starts a project. */
const startOrder = (cs: ContainerInfo[]): StackMember[][] => startWaves(cs).map(members);

/** Dependents first, the way compose stops one. */
const stopOrder = (cs: ContainerInfo[]): StackMember[][] => startOrder(cs).reverse();

const running = (stack: Stack): ContainerInfo[] => stack.services.filter((c) => isActive(c.status));

/** What a stack's `y` / `d` / `v` say they remove, from its plan. */
function removes(plan: StackDownPlan): string {
  const parts = [plural(plan.containers.length, 'container')];
  if (plan.networks.length > 0) parts.push(plural(plan.networks.length, 'network'));
  return `remove ${parts.join(', ')}`;
}

const volumeCount = (plan: StackDownPlan): number => plan.volumes.length + plan.anonymous.length;

/** `docker compose down`: everything but the data. */
function down(stack: Stack, plan: StackDownPlan, key: string): ActionChoice {
  return {
    key,
    label: 'Down',
    detail: `${removes(plan)} · keep volumes`,
    danger: true,
    run: () => downStack(stack.id, targets(stack, plan)),
    also: { networks: true },
    pending: `Taking ${stack.id} down…`,
  };
}

/** `docker compose down -v`: its named volumes and its containers' anonymous ones go too. */
function downWithVolumes(stack: Stack, plan: StackDownPlan): ActionChoice {
  const n = volumeCount(plan);
  return {
    key: 'v',
    label: 'Down -v',
    detail: `also delete ${plural(n, 'volume')}`,
    danger: true,
    ...(n === 0 ? { disabled: 'no volumes' } : {}),
    run: () => downStack(stack.id, targets(stack, plan), { volumes: true }),
    also: { networks: true, volumes: true },
    pending: `Taking ${stack.id} down, volumes too…`,
  };
}

function targets(stack: Stack, plan: StackDownPlan): StackDownTargets {
  return {
    stop: stopOrder(running(stack)),
    containers: members(plan.containers),
    networks: plan.networks.map(({ id, name }) => ({ id, name })),
    volumes: plan.volumes.map((v) => v.name),
  };
}

/** What stays whichever way it goes: networks and volumes a container outside the stack uses. */
function sharedNote(plan: StackDownPlan): string {
  if (plan.shared === 0) return '';
  return ` ${plural(plan.shared, 'network or volume')} shared with other containers ${plan.shared === 1 ? 'stays' : 'stay'}.`;
}

/** `s` on a live stack: stop it, or take it down with or without its volumes. */
export function stackStopDialog(stack: Stack, resources: StackResources): ActionDialog {
  const plan = stackDownPlan(stack, resources);
  const live = running(stack);
  return {
    title: `Stop stack ${stack.id}?`,
    message: `${live.length} of ${plural(stack.services.length, 'service')} running.${sharedNote(plan)}`,
    danger: true,
    choices: [
      {
        key: 'y',
        label: 'Stop',
        detail: 'keep its containers and data',
        run: () => stopStack(stack.id, stopOrder(live)),
        pending: `Stopping ${stack.id}…`,
      },
      down(stack, plan, 'd'),
      downWithVolumes(stack, plan),
    ],
  };
}

/** `d` on a stack, running or not. */
export function stackDownDialog(stack: Stack, resources: StackResources): ActionDialog {
  const plan = stackDownPlan(stack, resources);
  return {
    title: `Take stack ${stack.id} down?`,
    message: `Its containers and networks will be removed.${sharedNote(plan)}`,
    danger: true,
    choices: [down(stack, plan, 'y'), downWithVolumes(stack, plan)],
  };
}

/** `docker compose restart`: every service, stopped ones included; not the `compose run` leftovers. */
export function stackRestartDialog(stack: Stack): ActionDialog {
  const services = serviceContainers(stack).filter((c) => c.status !== 'dead' && c.status !== 'removing');
  return {
    title: `Restart stack ${stack.id}?`,
    message: `${plural(services.length, 'service')} will be restarted.`,
    choices: [
      {
        key: 'y',
        label: 'Yes',
        run: () => restartStack(stack.id, startOrder(services)),
        pending: `Restarting ${stack.id}…`,
      },
    ],
  };
}

export function stackKillDialog(stack: Stack): ActionDialog {
  const live = running(stack);
  return {
    title: `Kill stack ${stack.id}?`,
    message: `${plural(live.length, 'running service')} will be killed (SIGKILL).`,
    danger: true,
    choices: [
      { key: 'y', label: 'Yes, proceed', danger: true, run: () => killStack(stack.id, members(live)) },
    ],
  };
}

/** `docker compose start`: its stopped services, dependencies first. Null when none can start. */
export function stackStart(stack: Stack): { count: number; run: () => Promise<void> } | null {
  const stopped = serviceContainers(stack).filter((c) => c.status === 'exited' || c.status === 'created');
  if (stopped.length === 0) return null;
  return { count: stopped.length, run: () => startStack(stack.id, startOrder(stopped)) };
}
