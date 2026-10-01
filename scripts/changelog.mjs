#!/usr/bin/env node
// Changelog mechanics for the release process. Deliberately dumb and deterministic:
// the prose is written elsewhere (see CONTRIBUTING.md), this only moves it around.
//
//   node scripts/changelog.mjs extract <version>   print one section's body to stdout
//   node scripts/changelog.mjs promote [<bump>]    [Unreleased] -> [<version>] - <date>
//
// `extract` is the release gate: it exits non-zero when the section is missing or
// empty, which is what stops a tag from publishing without release notes. `promote` is
// what `npm run release` runs; <bump> is major, minor, patch or an explicit version, and
// when it is left out `promote` asks.

import { readFileSync, writeFileSync } from 'node:fs';

import { ask, CHANGELOG, fail, LOCKFILE, PACKAGE, readJson, repoUrl, setVersion } from './release-lib.mjs';

const UNRELEASED = 'Unreleased';
const HEADING = /^## \[([^\]]+)\](?:\s+-\s+(.+))?\s*$/;
const LINK_REF = /^\[([^\]]+)\]:\s*(\S+)\s*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const RELEASE_PARTS = /^(\d+)\.(\d+)\.(\d+)(-[^+]*)?(\+.*)?$/;
const BUMPS = ['major', 'minor', 'patch'];
const DEFAULT_BUMP = 'patch';

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

function today() {
  // Local date, not UTC: the changelog records the day the maintainer released.
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * 0.2.5 -> 1.0.0 / 0.3.0 / 0.2.6. A pre-release is finished rather than skipped, as npm's
 * own semver does it: patch and minor both take 0.3.0-rc.1 to 0.3.0, not past it.
 */
function bump(current, part) {
  const match = RELEASE_PARTS.exec(current);
  if (!match) fail(`cannot bump "${current}" — pass an explicit version instead`);
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  const pre = match[4] !== undefined;

  if (part === 'major') return pre && minor === 0 && patch === 0 ? `${major}.0.0` : `${major + 1}.0.0`;
  if (part === 'minor') return pre && patch === 0 ? `${major}.${minor}.0` : `${major}.${minor + 1}.0`;
  return pre ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch + 1}`;
}

/** The interactive half of `promote`: pick a part to bump, or type a version. */
async function askVersion(current) {
  const choices = BUMPS.map((part) => [part, bump(current, part)]);
  const fallback = BUMPS.indexOf(DEFAULT_BUMP) + 1;
  const custom = String(choices.length + 1);

  console.log(`Current version: ${current}`);
  choices.forEach(([part, version], i) => {
    const suffix = i + 1 === fallback ? '  (default)' : '';
    console.log(`  ${i + 1}) ${part.padEnd(6)} -> ${version}${suffix}`);
  });
  console.log(`  ${custom}) custom`);

  for (;;) {
    let answer = (await ask(`Bump [${fallback}]: `)).trim().toLowerCase();
    if (answer === '') return choices[fallback - 1][1];
    const chosen = choices.find(([part], i) => answer === String(i + 1) || answer === part);
    if (chosen) return chosen[1];
    if (answer === custom || answer === 'custom') answer = (await ask('Version: ')).trim();
    if (SEMVER.test(answer)) return answer;
    console.log(`  "${answer}" is neither a choice above nor a version like ${choices.at(-1)[1]}`);
  }
}

async function resolveVersion(spec, current) {
  if (BUMPS.includes(spec)) return bump(current, spec);
  if (spec !== undefined) return spec;
  if (!process.stdin.isTTY) {
    fail(`no version given and no terminal to ask on — pass one of ${BUMPS.join(', ')}`);
  }
  return askVersion(current);
}

function extract(version) {
  const { sections } = parse(readFileSync(CHANGELOG, 'utf8'));
  const section = findSection(sections, version);

  if (!section) {
    fail(
      `CHANGELOG.md has no section for ${version}.\n` +
        `Add one under [${UNRELEASED}], then run: npm run release ${version}`,
    );
  }
  if (isEmpty(section.body)) {
    fail(`CHANGELOG.md section for ${version} is empty — it needs at least one entry.`);
  }

  process.stdout.write(`${section.body.trim()}\n`);
}

async function promote(spec, { dryRun, date }) {
  const text = readFileSync(CHANGELOG, 'utf8');
  const { lines, sections, linkStart } = parse(text);
  const lock = readJson(LOCKFILE);
  const previousVersion = readJson(PACKAGE).version;

  // Everything that can fail without a version is checked before asking for one.
  const unreleased = findSection(sections, UNRELEASED);
  if (!unreleased) fail(`CHANGELOG.md has no [${UNRELEASED}] section to promote.`);
  if (isEmpty(unreleased.body)) {
    fail(
      `[${UNRELEASED}] is empty — nothing to release.\n` +
        `Write the notes first (see Releasing in CONTRIBUTING.md), then re-run.`,
    );
  }

  const version = await resolveVersion(spec, previousVersion);
  if (!SEMVER.test(version)) fail(`"${version}" is not a semantic version (expected e.g. 0.2.4)`);

  const existing = findSection(sections, version);
  if (existing) fail(`CHANGELOG.md already has a [${version}] section (line ${existing.index + 1}).`);

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

  if (dryRun) {
    console.log(`--- CHANGELOG.md (dry run) ---`);
    console.log(next.slice(0, unreleased.index + 6).join('\n'));
    console.log(`...`);
    console.log(`\npackage.json:      ${previousVersion} -> ${version}`);
    console.log(`package-lock.json: ${lock.version} -> ${version}`);
    return;
  }

  writeFileSync(CHANGELOG, next.join('\n'));
  writeFileSync(PACKAGE, setVersion(readFileSync(PACKAGE, 'utf8'), version));
  writeFileSync(LOCKFILE, setVersion(readFileSync(LOCKFILE, 'utf8'), version, true));

  console.log(`Released ${version} (${released})`);
  console.log(`  CHANGELOG.md      [${UNRELEASED}] -> [${version}]`);
  console.log(`  package.json      ${previousVersion} -> ${version}`);
  console.log(`  package-lock.json ${version}`);
  // Push both refs explicitly: --follow-tags only pushes annotated tags, so with a
  // lightweight tag it silently skips it, exits 0, and the release never starts.
  console.log(`\nNext — commits anything staged on its own first, then the release; tags; pushes:`);
  console.log(`  npm run release-git`);
  console.log(`or by hand, all in one commit:`);
  console.log(`  git commit -am "[Release] v${version}"`);
  console.log(`  git tag v${version} && git push origin main v${version}`);
}

function usage() {
  console.error('usage: node scripts/changelog.mjs extract <version>');
  console.error(
    '       node scripts/changelog.mjs promote [major|minor|patch|<version>] [--dry-run] [--date YYYY-MM-DD]',
  );
  process.exit(2);
}

const [command, ...args] = process.argv.slice(2);
const dateAt = args.indexOf('--date');
const [version] = args.filter((arg, i) => !arg.startsWith('--') && (dateAt === -1 || i !== dateAt + 1));
if (!command || (command === 'extract' && !version)) usage();

// `npm run release --dry-run` never reaches us: npm claims --dry-run as its own flag
// and forwards only the positional. It does set npm_config_dry_run, so honour that
// too — otherwise that command silently performs a real release.
const flags = {
  dryRun: args.includes('--dry-run') || process.env.npm_config_dry_run === 'true',
  date: dateAt === -1 ? undefined : args[dateAt + 1],
};

if (command === 'extract') extract(version);
else if (command === 'promote') await promote(version, flags);
else usage();
