import { PassThrough } from 'stream';
import blessed from 'neo-blessed';

/** Headless screen. Streams must be injected — under a pipe blessed reports cols/rows of 1. */
export function makeScreen(columns = 120, rows = 40): blessed.Widgets.Screen {
  const input: any = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => input;
  const output: any = new PassThrough();
  output.isTTY = true;
  output.columns = columns;
  output.rows = rows;
  output.resume();
  return blessed.screen({ input, output, terminal: 'xterm-256color', smartCSR: true, fullUnicode: true });
}

/**
 * Types raw bytes, as a terminal would. Goes through blessed's real key parser, so `'E'` arrives as
 * `S-e`, `'\r'` as both `enter` and `return`, and `screen.grabKeys` is honored — none of which
 * happens with `screen.emit('key …')`.
 */
export function press(screen: blessed.Widgets.Screen, bytes: string): void {
  screen.program.input.emit('data', Buffer.from(bytes));
}

export const KEY = {
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  pageUp: '\x1b[5~',
  pageDown: '\x1b[6~',
  home: '\x1b[H',
  end: '\x1b[F',
  enter: '\r',
  escape: '\x1b',
} as const;
