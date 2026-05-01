#!/usr/bin/env node
import { pingDocker } from '@docker/client';
import { App } from '@ui/app';
import { detectColors } from '@utils/term-caps';

async function main(): Promise<void> {
  const colors = detectColors();
  if (colors === 'low') {
    process.stderr.write(
      'docktui requires a 256-color (or truecolor) terminal. Set TERM=xterm-256color or use a modern terminal emulator.\n',
    );
    process.exit(1);
  }

  try {
    await pingDocker();
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  try {
    const app = new App();
    await app.start();
    process.exit(0);
  } catch (err) {
    process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
