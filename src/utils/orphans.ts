import { NO_STACK, type Stack } from '@utils/stacks';

/** What an orphan can be: a volume or network a compose project created. */
interface ProjectResource {
  stack?: string;
  inUse: boolean;
  orphaned?: boolean;
}

/**
 * The projects that still have containers, running or stopped: every stack but the catch-all.
 * Stacks, not just compose labels, so a project the Stacks view lists is never called empty.
 */
export function liveProjects(stacks: Stack[]): Set<string> {
  return new Set(stacks.filter((s) => s.id !== NO_STACK).map((s) => s.id));
}

/**
 * Marks the volumes or networks left behind by a compose project with no containers any more
 * (`docker compose down` keeps volumes; `rm` keeps networks too): unused, labelled with a project,
 * and that project is gone. Returns new items; the rest carry no `orphaned`.
 */
export function markOrphans<T extends ProjectResource>(items: T[], live: Set<string>): T[] {
  return items.map((item) => {
    const { orphaned: _stale, ...rest } = item;
    const orphaned = !item.inUse && item.stack !== undefined && !live.has(item.stack);
    return (orphaned ? { ...rest, orphaned } : rest) as T;
  });
}
