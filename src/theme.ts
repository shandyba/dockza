export const C = {
  // backgrounds
  bg: '#0a0908',
  bgSoft: '#0f0d0c',
  bgAlt: '#0f0d0c', // alias of bgSoft
  panel: '#13110f',
  bgSel: '#1a1840',
  selection: '#1a1840', // alias of bgSel
  bgSelEdge: '#6366f1',

  // text
  fg: '#e8e4d8',
  dim: '#8a8782',
  comment: '#8a8782', // alias of dim
  faint: '#5a5853',

  // rules / dividers
  rule: '#231f1c',
  rule2: '#2e2925',

  // accents
  accent: '#a5a0ff',
  purple: '#6366f1',
  green: '#5ed68a',
  aqua: '#5eead4',
  cyan: '#5eead4', // alias of aqua
  yellow: '#f4c64a',
  orange: '#fb923c',
  red: '#f87171',
  pink: '#f472b6',
} as const;

const tag = (hex: string, text: string): string => `{${hex}-fg}${text}{/}`;

export const t = {
  bg: (s: string) => tag(C.bg, s),
  bgSoft: (s: string) => tag(C.bgSoft, s),
  bgAlt: (s: string) => tag(C.bgAlt, s),
  panel: (s: string) => tag(C.panel, s),
  bgSel: (s: string) => tag(C.bgSel, s),
  selection: (s: string) => tag(C.selection, s),

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
