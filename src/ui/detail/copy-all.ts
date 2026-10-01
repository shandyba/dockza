import type { CopyOption } from '@ui/copy-menu';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The `a` option: every name in a list, one per line (repeats dropped). `noun` names one of them
 * in the footer (`3 container names`); `reason` says why there are none.
 */
export function allNames(names: string[], noun: string, reason: string, label = 'all'): CopyOption {
  const unique = [...new Set(names)];
  return {
    key: 'a',
    label: `${label} (${unique.length})`,
    preview: `${noun}s, one per line`,
    text: unique.length > 0 ? unique.join('\n') : null,
    reason,
    subject: plural(unique.length, noun),
  };
}
