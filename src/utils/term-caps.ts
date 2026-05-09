export type ColorSupport = 'truecolor' | '256' | 'low';

export function detectColors(env: NodeJS.ProcessEnv = process.env): ColorSupport {
  const colorterm = env.COLORTERM;
  if (colorterm === 'truecolor' || colorterm === '24bit') return 'truecolor';

  const term = env.TERM ?? '';
  if (term.includes('truecolor') || term.includes('24bit')) return 'truecolor';
  if (term.includes('256color') || term === 'xterm-kitty') return '256';

  return 'low';
}
