import dayjs from 'dayjs';
import relativeTimePlugin from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTimePlugin);

export function humanUptime(startedAt: Date): string {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function humanSizeMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GiB`;
  return `${Math.round(mb)} MiB`;
}

export function relativeTime(date: Date): string {
  return dayjs(date).fromNow();
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

export function truncateMiddle(s: string, maxLen: number, ellipsis = '…'): string {
  if (s.length <= maxLen) return s;
  if (maxLen <= ellipsis.length) return ellipsis.slice(0, maxLen);
  const keep = maxLen - ellipsis.length;
  const left = Math.ceil(keep / 2);
  const right = Math.floor(keep / 2);
  return s.slice(0, left) + ellipsis + s.slice(s.length - right);
}

export function stripTags(s: string): string {
  return s.replace(/\{[^}]+\}/g, '');
}

/**
 * Makes arbitrary text safe to drop into tag-enabled blessed content (what `blessed.escape` does).
 * Escape last: `stripTags` reads `{open}` as a zero-width tag, so measure and pad before this.
 */
export function escapeTags(s: string): string {
  return s.replace(/[{}]/g, (ch) => (ch === '{' ? '{open}' : '{close}'));
}

/** Columns a code point occupies. The UI injects blessed's table; plain text defaults to 1. */
export type CharWidth = (codePoint: number) => number;

const unitWidth: CharWidth = () => 1;

/**
 * Control characters → caret notation (`ESC` → `^[`, DEL → `^?`, C1 → `\x9b`) so untrusted text
 * can't smuggle terminal sequences onto the screen. `\n` is kept: callers decide how to show it.
 */
export function displaySafe(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x0a) out += ch;
    else if (code < 0x20) out += `^${String.fromCharCode(code + 0x40)}`;
    else if (code === 0x7f) out += '^?';
    else if (code >= 0x80 && code < 0xa0) out += `\\x${code.toString(16)}`;
    else out += ch;
  }
  return out;
}

export const NEWLINE_GLYPH = '⏎';

/** `displaySafe`, then newlines shown as `⏎` — a single-line rendering of any text. */
export function oneLine(s: string): string {
  return displaySafe(s).split('\n').join(NEWLINE_GLYPH);
}

export function textWidth(s: string, charWidth: CharWidth = unitWidth): number {
  let w = 0;
  for (const ch of s) w += Math.max(0, charWidth(ch.codePointAt(0) ?? 0));
  return w;
}

/** Width-aware `truncate`: fits `s` into `width` columns, ending in `…` when it had to cut. */
export function fitWidth(
  s: string,
  width: number,
  charWidth: CharWidth = unitWidth,
): { text: string; truncated: boolean } {
  const max = Math.max(1, Math.floor(width));
  if (textWidth(s, charWidth) <= max) return { text: s, truncated: false };
  let text = '';
  let used = 0;
  for (const ch of s) {
    const w = Math.max(0, charWidth(ch.codePointAt(0) ?? 0));
    if (used + w > max - 1) break;
    text += ch;
    used += w;
  }
  return { text: `${text}…`, truncated: true };
}

/**
 * Hard-wraps one line (no `\n`) into pieces of at most `width` columns — `firstWidth` for the first
 * piece, so a caller can hang-indent the rest. Splits between code points, never inside a surrogate
 * pair, and moves a wide glyph to the next piece rather than letting it straddle the edge.
 */
export function wrapLine(
  s: string,
  width: number,
  charWidth: CharWidth = unitWidth,
  firstWidth: number = width,
): string[] {
  const rest = Math.max(1, Math.floor(width));
  let max = Math.max(1, Math.floor(firstWidth));
  const out: string[] = [];
  let line = '';
  let used = 0;
  for (const ch of s) {
    const w = Math.max(0, charWidth(ch.codePointAt(0) ?? 0));
    if (used + w > max && line !== '') {
      out.push(line);
      line = '';
      used = 0;
      max = rest;
    }
    line += ch;
    used += w;
  }
  out.push(line);
  return out;
}

export function visualLength(s: string): number {
  return stripTags(s).length;
}

export function padEnd(s: string, visualLen: number): string {
  const pad = visualLen - visualLength(s);
  if (pad <= 0) return s;
  return s + ' '.repeat(pad);
}
