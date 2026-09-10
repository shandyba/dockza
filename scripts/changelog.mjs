#!/usr/bin/env node
// Changelog mechanics for the release process. Deliberately dumb and deterministic:
// the prose is drafted by hand (or by /release-notes), this only moves it around.
//
//   node scripts/changelog.mjs extract <version>   print one section's body to stdout
//   node scripts/changelog.mjs promote <version>   [Unreleased] -> [<version>] - <date>
//
// `extract` is the release gate: it exits non-zero when the section is missing or
// empty, which is what stops a tag from publishing without release notes.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG = join(ROOT, 'CHANGELOG.md');
const PACKAGE = join(ROOT, 'package.json');
const LOCKFILE = join(ROOT, 'package-lock.json');

const UNRELEASED = 'Unreleased';
const HEADING = /^## \[([^\]]+)\](?:\s+-\s+(.+))?\s*$/;
const LINK_REF = /^\[([^\]]+)\]:\s*(\S+)\s*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** Parse the changelog into sections plus the trailing link-reference block. */
function parse(text) {
  const lines = text.split('\n');

  // The link-ref block is the run of `[x]: url` lines at the end of the file.
  let linkStart = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (!LINK_REF.test(line)) break;
    linkStart = i;
  }

  const headings = [];
  for (let i = 0; i < linkStart; i++) {
    const match = HEADING.exec(lines[i]);
    if (match) headings.push({ index: i, version: match[1], date: match[2] ?? null });
  }

  const sections = headings.map((heading, n) => {
    const end = n + 1 < headings.length ? headings[n + 1].index : linkStart;
    return { ...heading, end, body: lines.slice(heading.index + 1, end).join('\n') };
  });

  return {
    lines,
    sections,
    linkStart,
    preambleEnd: headings.length ? headings[0].index : linkStart,
  };
}

/**
 * A section counts as empty when it carries no actual entries — bare `### Fixed`
 * subheadings with nothing under them must not satisfy the release gate.
 */
function isEmpty(body) {
  return !body
    .split('\n')
    .some((line) => line.trim() !== '' && !line.trimStart().startsWith('#'));
}

function findSection(sections, version) {
  return sections.find((section) => section.version === version) ?? null;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Preserve the file's existing indentation and trailing newline. */
function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** `git+https://github.com/owner/repo.git` -> `https://github.com/owner/repo` */
function repoUrl() {
  const { repository } = readJson(PACKAGE);
  const raw = typeof repository === 'string' ? repository : (repository?.url ?? '');
  const url = raw.replace(/^git\+/, '').replace(/\.git$/, '');
  if (!url) throw new Error('package.json has no repository.url to build changelog links from');
  return url;
}

function today() {
  // Local date, not UTC: the changelog records the day the maintainer released.
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function extract(version) {
  const { sections } = parse(readFileSync(CHANGELOG, 'utf8'));
  const section = findSection(sections, version);

  if (!section) {
    fail(
      `CHANGELOG.md has no section for ${version}.\n` +
        `Add one under [${UNRELEASED}] (try /release-notes), then run: npm run release ${version}`,
    );
  }
  if (isEmpty(section.body)) {
    fail(`CHANGELOG.md section for ${version} is empty — it needs at least one entry.`);
  }

  process.stdout.write(`${section.body.trim()}\n`);
}

function promote(version, { dryRun, date }) {
  if (!SEMVER.test(version)) fail(`"${version}" is not a semantic version (expected e.g. 0.2.4)`);

  const text = readFileSync(CHANGELOG, 'utf8');
  const { lines, sections, linkStart } = parse(text);

  const existing = findSection(sections, version);
  if (existing) fail(`CHANGELOG.md already has a [${version}] section (line ${existing.index + 1}).`);

  const unreleased = findSection(sections, UNRELEASED);
  if (!unreleased) fail(`CHANGELOG.md has no [${UNRELEASED}] section to promote.`);
  if (isEmpty(unreleased.body)) {
    fail(
      `[${UNRELEASED}] is empty — nothing to release.\n` +
        `Draft notes with /release-notes first, then re-run.`,
    );
  }

  const url = repoUrl();
  const released = date ?? today();
  const next = [...lines];

  // Rewrite the trailing link refs first, so the line indices above stay valid.
  const refs = [];
  for (let i = linkStart; i < next.length; i++) {
    const match = LINK_REF.exec(next[i]);
    if (match) refs.push({ index: i, label: match[1] });
  }
  const unreleasedRef = refs.find((ref) => ref.label === UNRELEASED);
  const newRef = `[${version}]: ${url}/releases/tag/v${version}`;

  if (unreleasedRef) {
    next[unreleasedRef.index] = `[${UNRELEASED}]: ${url}/compare/v${version}...HEAD`;
    next.splice(unreleasedRef.index + 1, 0, newRef);
  } else {
    // No Unreleased ref to anchor to — put both at the top of the block.
    next.splice(linkStart, 0, `[${UNRELEASED}]: ${url}/compare/v${version}...HEAD`, newRef);
  }

  // Then retitle [Unreleased] and open a fresh empty one above it.
  next[unreleased.index] = `## [${version}] - ${released}`;
  next.splice(unreleased.index, 0, `## [${UNRELEASED}]`, '');

  const pkg = readJson(PACKAGE);
  const lock = readJson(LOCKFILE);
  const previousVersion = pkg.version;

  if (dryRun) {
    console.log(`--- CHANGELOG.md (dry run) ---`);
    console.log(next.slice(0, unreleased.index + 6).join('\n'));
    console.log(`...`);
    console.log(`\npackage.json:      ${previousVersion} -> ${version}`);
    console.log(`package-lock.json: ${lock.version} -> ${version}`);
    return;
  }

  writeFileSync(CHANGELOG, next.join('\n'));

  pkg.version = version;
  writeJson(PACKAGE, pkg);

  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
  writeJson(LOCKFILE, lock);

  console.log(`Released ${version} (${released})`);
  console.log(`  CHANGELOG.md      [${UNRELEASED}] -> [${version}]`);
  console.log(`  package.json      ${previousVersion} -> ${version}`);
  console.log(`  package-lock.json ${version}`);
  console.log(`\nNext:`);
  console.log(`  git commit -am "[Release] v${version}"`);
  console.log(`  git tag v${version} && git push --follow-tags`);
}

function usage() {
  console.error('usage: node scripts/changelog.mjs extract <version>');
  console.error('       node scripts/changelog.mjs promote <version> [--dry-run] [--date YYYY-MM-DD]');
  process.exit(2);
}

const [command, version, ...rest] = process.argv.slice(2);
if (!command || !version) usage();

// `npm run release 0.2.4 --dry-run` never reaches us: npm claims --dry-run as its
// own flag and forwards only the positional. It does set npm_config_dry_run, so
// honour that too — otherwise that command silently performs a real release.
const flags = {
  dryRun: rest.includes('--dry-run') || process.env.npm_config_dry_run === 'true',
  date: rest.includes('--date') ? rest[rest.indexOf('--date') + 1] : undefined,
};

if (command === 'extract') extract(version);
else if (command === 'promote') promote(version, flags);
else usage();
