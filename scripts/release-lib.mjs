// Shared by the release scripts: scripts/changelog.mjs (the notes, the version bump and
// the CI gate) and scripts/release-git.mjs (the commits, the tag and the push). Plain Node
// ESM with no dependencies, like both of them.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CHANGELOG = join(ROOT, 'CHANGELOG.md');
export const PACKAGE = join(ROOT, 'package.json');
export const LOCKFILE = join(ROOT, 'package-lock.json');

export function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** `git+https://github.com/owner/repo.git` -> `https://github.com/owner/repo` */
export function repoUrl() {
  const { repository } = readJson(PACKAGE);
  const raw = typeof repository === 'string' ? repository : (repository?.url ?? '');
  const url = raw.replace(/^git\+/, '').replace(/\.git$/, '');
  if (!url) throw new Error('package.json has no repository.url to build links from');
  return url;
}

/**
 * A manifest's text with our version rewritten: package.json's, or both of the places
 * package-lock.json keeps it. Written back the way npm writes it — two-space indent and a
 * trailing newline — so the rest of the file comes out as it went in.
 */
export function setVersion(text, version, lockfile = false) {
  const json = JSON.parse(text);
  json.version = version;
  if (lockfile && json.packages?.['']) json.packages[''].version = version;
  return `${JSON.stringify(json, null, 2)}\n`;
}

/** One line from the terminal. Ctrl-C or Ctrl-D abandons the whole command. */
export async function ask(question) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  let answered = false;
  const abandon = () => {
    if (answered) return;
    process.stdout.write('\n');
    fail('aborted — nothing was written');
  };
  prompt.on('SIGINT', abandon);
  prompt.on('close', abandon);
  try {
    const answer = await prompt.question(question);
    answered = true;
    return answer;
  } finally {
    prompt.close();
  }
}
