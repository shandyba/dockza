import { humanSizeMB } from '@utils/format';
import type { ActionChoice, ActionDialog } from '@ui/containers/confirm-dialog';

/** How a list names its rows and deletes one, for the dialogs that delete several at once. */
export interface BulkTarget<T> {
  /** Singular, for counts: `3 volumes`. */
  noun: string;
  nameOf: (item: T) => string;
  remove: (item: T) => Promise<void>;
  /** Its size in MB, for what a clean-up frees; 0 when unknown. */
  sizeMB?: (item: T) => number;
}

/**
 * A kind of row `D` deletes all of at once: every dangling volume, say. The same kind of leftover
 * takes the same key in every view (`d` dangling, `o` orphaned, `u` unused).
 */
export interface Cleanup<T> {
  key: string;
  label: string;
  /** What qualifies, after its count. */
  detail: string;
  matches: (item: T) => boolean;
}

export const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** The first few names, then how many more: `a, b, c and 2 more`. */
export function nameList(names: string[], max = 3): string {
  if (names.length <= max) {
    return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  }
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

const reasonOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Deletes each in turn: one at a time, so the daemon sees what a person would do, and a failure
 * doesn't stop the rest. Throws one error naming everything that failed, with the first reason
 * (the rest are usually alike).
 */
export async function removeEach<T>(target: BulkTarget<T>, items: T[]): Promise<void> {
  const failed: string[] = [];
  let reason = '';
  for (const item of items) {
    try {
      await target.remove(item);
    } catch (err) {
      failed.push(target.nameOf(item));
      reason ||= reasonOf(err);
    }
  }
  if (failed.length === 0) return;
  const removed = items.length - failed.length;
  throw new Error(
    `Removed ${removed} of ${plural(items.length, target.noun)}; couldn't remove ${nameList(failed)} — ${reason}`,
  );
}

/** Deleting these, as a dialog choice: says so as it starts and once it's done. */
function removing<T>(target: BulkTarget<T>, items: T[]): Pick<ActionChoice, 'run' | 'pending' | 'done'> {
  const what = plural(items.length, target.noun);
  return {
    run: () => removeEach(target, items),
    pending: `Removing ${what}…`,
    done: `Removed ${what}`,
  };
}

interface MarkedCounts {
  /** Marked, but a guard keeps them: in use, built in. */
  blocked: number;
  /** Among those to delete, how many the filter hides. */
  hidden: number;
}

/** `d` with rows marked: every marked row that may go, named before it does. */
export function removeMarkedDialog<T>(target: BulkTarget<T>, items: T[], counts: MarkedCounts): ActionDialog {
  const notes = [`${nameList(items.map(target.nameOf))} will be permanently deleted.`];
  if (counts.hidden > 0)
    notes.push(`${counts.hidden} of them ${counts.hidden === 1 ? 'is' : 'are'} hidden by the filter.`);
  if (counts.blocked > 0) notes.push(`${counts.blocked} more marked can't be deleted and stay marked.`);
  return {
    title: `Remove ${plural(items.length, target.noun)}?`,
    message: notes.join(' '),
    danger: true,
    choices: [{ key: 'y', label: 'Yes, proceed', danger: true, ...removing(target, items) }],
  };
}

/**
 * `D`: one choice per kind of leftover, each with how many there are and, where the list knows, the
 * space they take. `pool` is what may be deleted among the rows shown, so the filter narrows it;
 * `shown` says how many rows that was, when a filter is on. The pick is the confirmation.
 */
export function cleanupDialog<T>(
  target: BulkTarget<T>,
  cleanups: Cleanup<T>[],
  pool: T[],
  shown?: number,
): ActionDialog {
  const picks = cleanups.map((c) => {
    const items = pool.filter(c.matches);
    const mb = target.sizeMB ? items.reduce((sum, i) => sum + target.sizeMB!(i), 0) : 0;
    return {
      cleanup: c,
      items,
      count: plural(items.length, target.noun),
      size: mb > 0 ? humanSizeMB(mb) : '—',
    };
  });
  const countW = Math.max(...picks.map((p) => p.count.length));
  // A size column only where the list knows one: `—` for a kind whose size it doesn't.
  const sizeW = picks.some((p) => p.size !== '—') ? Math.max(...picks.map((p) => p.size.length)) : 0;

  const choices = picks.map(({ cleanup, items, count, size }): ActionChoice => {
    const amount = sizeW > 0 ? `${count.padStart(countW)} · ${size.padStart(sizeW)}` : count.padStart(countW);
    return {
      key: cleanup.key,
      label: cleanup.label,
      detail: `${amount}   ${cleanup.detail}`,
      danger: true,
      ...(items.length === 0 ? { disabled: 'none' } : {}),
      ...removing(target, items),
    };
  });

  const scope = shown === undefined ? '' : `Only among the ${shown} the filter shows. `;
  return {
    title: `Clean up ${target.noun}s?`,
    message: `${scope}Deleted for good; nothing in use is touched.`,
    danger: true,
    choices,
  };
}
