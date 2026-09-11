/**
 * blessed has no truecolor: every hex below is snapped to the nearest xterm-256 entry, using a
 * luma-weighted distance that counts blue for almost nothing. A dark blue-tinted color therefore
 * lands on a neutral grey — which is what happened to the old `#1a1840` selection: it rendered as
 * `#1c1c1c`, one step off the background, so the highlighted row was all but invisible.
 *
 * Two rules when touching these values:
 *   - judge a color by the palette entry it resolves to, not by the hex;
 *   - keep it a shade off an exact palette value. blessed pre-seeds its match cache with the
 *     16-color approximation of every cube/grey hex, so `#5f5f87` comes back as plain blue while
 *     `#62608a` resolves to xterm 60 — the color `#5f5f87` actually names.
 * The trailing comment on each line is the entry it resolves to today.
 */
export const C = {
  // backgrounds
  bg: '#0a0908', // 232
  bgSoft: '#0f0d0c', // 233
  bgAlt: '#0f0d0c', // alias of bgSoft
  panel: '#13110f', // 233
  surface: '#1a1840', // 234 — raised chrome: header bars, list borders, dialog bodies
  bgSel: '#62608a', // 60  — the selected row; reads as indigo, not as another grey

  // text
  fg: '#e8e4d8', // 254
  dim: '#8a8782', // 102
  comment: '#8a8782', // alias of dim
  faint: '#5a5853', // 240

  // rules / dividers
  rule: '#231f1c', // 234
  rule2: '#2e2925', // 235

  // accents
  accent: '#a5a0ff', // 147
  purple: '#6366f1', // 63
  green: '#5ed68a', // 78
  aqua: '#5eead4', // 80
  cyan: '#5eead4', // alias of aqua
  yellow: '#f4c64a', // 221
  orange: '#fb923c', // 209
  red: '#f87171', // 203
  pink: '#f472b6', // 205
} as const;

const tag = (hex: string, text: string): string => `{${hex}-fg}${text}{/}`;

export const t = {
  bg: (s: string) => tag(C.bg, s),
  bgSoft: (s: string) => tag(C.bgSoft, s),
  bgAlt: (s: string) => tag(C.bgAlt, s),
  panel: (s: string) => tag(C.panel, s),
  surface: (s: string) => tag(C.surface, s),
  bgSel: (s: string) => tag(C.bgSel, s),

  fg: (s: string) => tag(C.fg, s),
  dim: (s: string) => tag(C.dim, s),
  comment: (s: string) => tag(C.comment, s),
  faint: (s: string) => tag(C.faint, s),

  rule: (s: string) => tag(C.rule, s),
  rule2: (s: string) => tag(C.rule2, s),

  accent: (s: string) => tag(C.accent, s),
  purple: (s: string) => tag(C.purple, s),
  green: (s: string) => tag(C.green, s),
  aqua: (s: string) => tag(C.aqua, s),
  cyan: (s: string) => tag(C.cyan, s),
  yellow: (s: string) => tag(C.yellow, s),
  orange: (s: string) => tag(C.orange, s),
  red: (s: string) => tag(C.red, s),
  pink: (s: string) => tag(C.pink, s),
};
