import type { ResourceRef } from '@models/nav';
import { t } from '@theme';
import { stackRef } from '@utils/nav-history';
import { textOption, type CopyOption } from '@ui/copy-menu';
import type { RefSectionSpec } from '@ui/detail/ref-section';

/** One single-valued reference: the image a container runs, the stack it belongs to, … */
export interface RelatedRow {
  /** Stable: keeps the selection on it across polls, and in history. */
  key: string;
  /** What the other object is to this one (`image`, `stack`). */
  label: string;
  /** Its name: a link when `ref` is set. */
  text: string;
  /** After the name: a detail (`· service db`), or a warning when `warn` is set. */
  note?: string;
  warn?: boolean;
  /** `null`: nothing to open (an anonymous volume's origin, a project with no containers left). */
  ref: ResourceRef | null;
  copy: CopyOption[];
}

/**
 * A detail's RELATED section: the objects it has exactly one of, one row each, so Tab reaches all
 * of them in one stop instead of one per relation. Lists of references get their own section.
 *
 *   image  postgres:18
 *   stack  db-pr02      · service db
 *
 * The rows are data: each detail builds its own, copy options included.
 */
export function relatedRows(empty: string): RefSectionSpec<RelatedRow> {
  return {
    id: 'related',
    title: 'RELATED',
    follow: 'open',
    empty,
    key: (r) => r.key,
    cells: (r) => [
      { text: r.label, color: t.comment },
      { text: r.text, grow: true, link: true },
      { text: r.note ?? '', grow: true, color: r.warn ? t.orange : t.comment },
    ],
    ref: (r) => r.ref,
    copy: (r) => r.copy,
  };
}

/**
 * The compose project a volume or network belongs to: a link to its stack, `what` naming its key
 * there (`· volume data`). Once no container of the project is left there is no stack to open, and
 * the row says so instead.
 */
export function projectRow(project: string, what: string | undefined, orphaned: boolean): RelatedRow {
  const copy = [textOption('n', 'project', project, 'project')];
  if (orphaned) {
    return {
      key: 'stack',
      label: 'project',
      text: project,
      note: 'has no containers',
      warn: true,
      ref: null,
      copy,
    };
  }
  return {
    key: 'stack',
    label: 'stack',
    text: project,
    ...(what ? { note: `· ${what}` } : {}),
    ref: stackRef({ id: project }),
    copy,
  };
}
