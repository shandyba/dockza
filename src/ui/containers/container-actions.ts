import { killContainer, removeContainer, restartContainer, stopContainer } from '@docker/containers';
import type { ContainerInfo } from '@models/docker';
import { anonymousVolumes } from '@utils/mounts';
import { isActive } from '@utils/status';
import type { ActionChoice, ActionDialog } from '@ui/containers/confirm-dialog';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** `docker rm`, after a graceful `docker stop` when it's running (`rm -f` alone would SIGKILL it). */
async function remove(c: ContainerInfo, volumes: boolean): Promise<void> {
  if (isActive(c.status)) await stopContainer(c.id);
  await removeContainer(c.id, { volumes });
}

/** `docker rm -v`: its anonymous volumes go too. Named volumes never do, so with none it's greyed out. */
function removeWithVolumes(c: ContainerInfo): ActionChoice {
  const anonymous = anonymousVolumes([c]).length;
  return {
    key: 'v',
    label: 'Remove -v',
    detail: `also delete its ${plural(anonymous, 'anonymous volume')}`,
    danger: true,
    ...(anonymous === 0 ? { disabled: 'no anonymous volumes (named ones are always kept)' } : {}),
    run: () => remove(c, true),
    also: { volumes: true },
  };
}

/** `s`: stopping deletes nothing, so the ways to stop *and* clean up sit next to it. */
export function containerStopDialog(c: ContainerInfo): ActionDialog {
  return {
    title: 'Stop container?',
    message: `${c.name} is ${c.status}.`,
    danger: true,
    choices: [
      { key: 'y', label: 'Stop', detail: 'keep the container and its data', run: () => stopContainer(c.id) },
      {
        key: 'd',
        label: 'Remove',
        detail: 'stop it, then remove it · keep its volumes',
        danger: true,
        run: () => remove(c, false),
      },
      removeWithVolumes(c),
    ],
  };
}

/** `d` on a stopped container. */
export function containerRemoveDialog(c: ContainerInfo): ActionDialog {
  return {
    title: 'Remove container?',
    message: `${c.name} will be permanently removed.`,
    danger: true,
    choices: [
      { key: 'y', label: 'Remove', detail: 'keep its volumes', danger: true, run: () => remove(c, false) },
      removeWithVolumes(c),
    ],
  };
}

export function containerRestartDialog(c: ContainerInfo): ActionDialog {
  return {
    title: 'Restart container?',
    message: `${c.name} will be restarted.`,
    choices: [{ key: 'y', label: 'Yes', run: () => restartContainer(c.id) }],
  };
}

export function containerKillDialog(c: ContainerInfo): ActionDialog {
  return {
    title: 'Kill container?',
    message: `${c.name} will be killed (SIGKILL).`,
    danger: true,
    choices: [{ key: 'y', label: 'Yes, proceed', danger: true, run: () => killContainer(c.id) }],
  };
}
