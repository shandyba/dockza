#!/usr/bin/env node
// Commit, tag and push the release that `npm run release` just promoted.
//
//   npm run release-git                   asks once, before anything is written
//   npm run release-git -- --yes          no question; the drafted message is used as is
//   npm run release-git -- --no-push      commit and tag, then stop
//   npm run release-git -- -m "<msg>"     message for the staged work instead of a draft
//
// Flags go after `--`: npm keeps the ones before it for itself (see parseArgs).
//
// The version is read from package.json, where `npm run release` wrote it: it is chosen
// once and never typed again. What gets written, in order:
//
// 1. Whatever is staged, as a commit of its own. CHANGELOG.md and the version bump are
//    held out of it even when they were staged too: they belong to the release. Nothing
//    staged, no commit. Its message comes from -m, the draft command below, or your editor.
// 2. `[Release] v<version>`: CHANGELOG.md, package.json and package-lock.json as they
//    stand in the working tree, and nothing else. Unstaged changes to any other file
//    stay unstaged — the notes were not written from them, so they are not in this release.
// 3. The tag, then one `git push --atomic` of main and the tag together, so the tag can
//    never reach GitHub (and start an npm publish) without the commit it points at.
//
// A rerun picks up where the last one stopped: a release commit made by hand is tagged
// rather than redone, and a tag that exists at HEAD is only pushed.
//
// Draft command: `git config release.draftCommand '<command>'`, local to the clone, names a
// shell command that proposes the message for step 1, shown at the prompt to accept or
// edit. It runs from the repository root with GIT_INDEX_FILE pointing at the tree that
// commit will record — `git diff --cached HEAD` in it shows exactly the change being
// described — RELEASE_VERSION set, and the version's release notes on stdin. What it
// prints is the proposal; a non-zero exit or no output means there is none.

import { spawnSync } from 'node:child_process';
import { copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ask, fail, PACKAGE, readJson, repoUrl, ROOT, setVersion } from './release-lib.mjs';

const BRANCH = 'main';
const REMOTE = 'origin';
const RELEASE_FILES = ['CHANGELOG.md', 'package.json', 'package-lock.json'];
const DRAFT_COMMAND = 'release.draftCommand';
// The lockfile can outgrow spawnSync's default 1 MiB output cap.
const MAX_BUFFER = 256 * 1024 * 1024;

// ------------------------------------------------------------------------- git

function run(args, { env, input } = {}) {
  return spawnSync('git', args, { cwd: ROOT, env, input, encoding: 'utf8', maxBuffer: MAX_BUFFER });
}

/** stdout, untrimmed — some callers read file contents through it. */
function git(args, options) {
  const result = run(args, options);
  if (result.status !== 0) {
    fail(`git ${args.join(' ')} failed:\n${(result.stderr || result.error?.message || '').trim()}`);
  }
  return result.stdout;
}

const ok = (args, options) => run(args, options).status === 0;

/** Run with the terminal attached — hooks print, and `commit -e` opens an editor. */
const attached = (args, { env } = {}) =>
  spawnSync('git', args, { cwd: ROOT, env, stdio: 'inherit' }).status === 0;

const gitPath = (name) => resolve(ROOT, git(['rev-parse', '--git-path', name]).trim());

const lines = (text) => text.split('\n').filter(Boolean);

// ----------------------------------------------------------------- staged work

/**
 * Copy the index to `path`, minus the release: the tree the first commit records.
 *
 * Returns the environment that points git at the copy, or null when the copy matches
 * HEAD — nothing is staged but the release itself. The real index is never touched, so
 * declining at the prompt leaves the checkout exactly as it was.
 */
function stagedWorkIndex(path) {
  copyFileSync(gitPath('index'), path);
  const env = { ...process.env, GIT_INDEX_FILE: path };

  for (const name of RELEASE_FILES) {
    const [mode, stagedSha] = git(['ls-files', '-s', '--', name], { env }).split(/\s+/);
    if (!stagedSha) continue;

    let heldSha;
    if (name === 'CHANGELOG.md') {
      heldSha = git(['rev-parse', `HEAD:${name}`]).trim();
    } else {
      // A staged manifest can carry real work (a new dependency) alongside the version
      // bump. Keep the work, put HEAD's version back.
      const staged = git(['cat-file', 'blob', stagedSha]);
      const before = JSON.parse(git(['show', `HEAD:${name}`])).version;
      if (JSON.parse(staged).version === before) continue;
      const held = setVersion(staged, before, name === 'package-lock.json');
      heldSha = git(['hash-object', '-w', '--stdin'], { input: held }).trim();
    }

    if (heldSha !== stagedSha) git(['update-index', '--cacheinfo', `${mode},${heldSha},${name}`], { env });
  }

  return ok(['diff', '--cached', '--quiet', 'HEAD'], { env }) ? null : env;
}

/** The draft command's proposal for the staged work, or null without one (see the top). */
function draftMessage(env, version, notes) {
  const command = run(['config', '--get', DRAFT_COMMAND]).stdout.trim();
  if (!command) return null;

  console.log('Drafting a commit message for the staged work...');
  const result = spawnSync(command, {
    cwd: ROOT,
    env: { ...env, RELEASE_VERSION: version },
    input: notes,
    shell: true,
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: MAX_BUFFER,
  });

  const message = (result.stdout ?? '').trim();
  if (result.status !== 0 || !message) {
    const reason = (result.stderr ?? '').trim() || result.error?.message || 'no output';
    console.log(`  note: ${DRAFT_COMMAND} gave no draft (${reason})`);
    return null;
  }
  return message;
}

// ------------------------------------------------------------------------ plan

/** Changes this release will not contain, so nobody mistakes them for shipped. */
function leftOut(pending) {
  const out = [];
  for (const name of lines(git(['diff', '--name-only']))) {
    if (!RELEASE_FILES.includes(name)) out.push(`not staged  ${name}`);
  }
  if (!pending) {
    // The release commit already exists; staged work would land after it.
    for (const name of lines(git(['diff', '--cached', '--name-only']))) out.push(`staged      ${name}`);
  }
  for (const name of lines(git(['ls-files', '--others', '--exclude-standard']))) {
    out.push(`untracked   ${name}`);
  }
  return out;
}

/**
 * Ask before anything is written. Declining exits; otherwise the answer is whether to
 * open the drafted message in an editor first.
 */
async function confirm(canEdit) {
  if (!process.stdin.isTTY) fail('nothing was written: no terminal to confirm on — pass --yes');
  const choices = canEdit ? '[Y]es, [e]dit the message, [n]o' : '[Y]es, [n]o';
  for (;;) {
    const answer = (await ask(`\nGo ahead? ${choices}: `)).trim().toLowerCase();
    if (['', 'y', 'yes'].includes(answer)) return false;
    if (canEdit && ['e', 'edit'].includes(answer)) return true;
    if (['n', 'no'].includes(answer)) fail('aborted — nothing was written');
  }
}

// ----------------------------------------------------------------------- steps

const commitSummary = () => git(['log', '-1', '--format=%h %s']).trim();

function push(tag, noPush) {
  const command = `git push --atomic ${REMOTE} ${BRANCH} ${tag}`;
  if (noPush) {
    console.log(`\nNot pushed. When you are ready:\n  ${command}`);
    return;
  }

  console.log(`\n${command}`);
  if (!attached(['push', '--atomic', REMOTE, BRANCH, tag])) {
    fail(
      `the push failed, so ${tag} and its commits are only local. ` +
        'Rerun npm run release-git to retry — it only pushes.',
    );
  }
  console.log(`\nPushed. ${tag} is building: ${repoUrl()}/actions/workflows/release.yml`);
}

/**
 * npm keeps flags given before `--` for itself, and hands them on only as npm_config_*
 * variables — which .npmrc fills too, so they cannot be told apart from a setting left
 * there for npx. Take back only the flag that errs on the safe side; name the others.
 */
function parseArgs(argv) {
  const args = { yes: false, noPush: false, message: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-y' || arg === '--yes') args.yes = true;
    else if (arg === '--no-push') args.noPush = true;
    else if (arg === '-m' || arg === '--message') {
      args.message = argv[++i];
      if (!args.message) fail(`${arg} needs a message`);
    } else fail(`unknown argument "${arg}" — see the top of scripts/release-git.mjs`);
  }

  const env = process.env;
  if (env.npm_config_push === '' || env.npm_config_push === 'false') args.noPush = true;
  if (env.npm_config_yes === 'true' && !args.yes) {
    console.log('  note: npm kept --yes for itself, so this still asks. Use: npm run release-git -- --yes');
  }
  if (env.npm_config_message && !args.message) {
    console.log('  note: npm kept -m for itself, so it is unused. Use: npm run release-git -- -m "..."');
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const version = readJson(PACKAGE).version;
  const tag = `v${version}`;

  const branch = git(['branch', '--show-current']).trim();
  if (branch !== BRANCH) {
    fail(`releases are cut from ${BRANCH}, and this checkout is on ${branch || 'no branch'}`);
  }

  const head = git(['rev-parse', 'HEAD']).trim();
  const tagged = run(['rev-parse', '-q', '--verify', `refs/tags/${tag}^{commit}`]);
  if (tagged.status === 0) {
    if (tagged.stdout.trim() !== head) {
      fail(
        `${tag} is already tagged, on an earlier commit — package.json has not been bumped. ` +
          'Run npm run release first.',
      );
    }
    console.log(`${tag} is already tagged at HEAD; only the push is left.`);
    push(tag, args.noPush);
    return;
  }

  // The gate CI runs first, run here before anything is committed.
  const gate = spawnSync(process.execPath, [join(ROOT, 'scripts', 'changelog.mjs'), 'extract', version], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (gate.status !== 0) fail(`CHANGELOG.md has no notes for ${version}. Run npm run release first.`);
  const notes = gate.stdout;

  const pending = !ok(['diff', '--quiet', 'HEAD', '--', ...RELEASE_FILES]);
  if (!pending && git(['log', '-1', '--format=%s']).trim() !== `[Release] ${tag}`) {
    fail(
      `HEAD already has ${version} in package.json, but HEAD is not its release commit. ` +
        `Tag the right commit by hand: git tag ${tag} <commit>`,
    );
  }

  // With --no-push too: a tag cut behind the remote cannot be pushed later, only deleted
  // and cut again after a pull.
  const fetched = run(['fetch', '--quiet', REMOTE, BRANCH]);
  if (fetched.status !== 0) fail(`could not fetch ${REMOTE}/${BRANCH}:\n${fetched.stderr.trim()}`);
  if (!ok(['merge-base', '--is-ancestor', 'FETCH_HEAD', 'HEAD'])) {
    fail(`${REMOTE}/${BRANCH} has commits this checkout does not. Pull them first.`);
  }

  const indexPath = gitPath('dockza-release.index');
  const messagePath = gitPath('dockza-release.msg');
  // fail() exits on the spot, past any `finally`, so the cleanup hangs off exit instead.
  process.on('exit', () => [indexPath, messagePath].forEach((path) => rmSync(path, { force: true })));

  const env = pending ? stagedWorkIndex(indexPath) : null;

  let message = null;
  if (env) {
    message = args.message ?? draftMessage(env, version, notes);
    if (message === null && args.yes) {
      fail('nothing was written: the staged work has no commit message — pass -m');
    }
  } else if (args.message) {
    console.log('  note: nothing is staged besides the release, so -m is unused');
  }

  let step = 0;
  console.log(`\nRelease ${tag}:`);
  if (env) {
    const files = lines(git(['diff', '--cached', '--name-only', 'HEAD'], { env }));
    console.log(`  ${++step}. commit the staged work, ${files.length} file(s):`);
    for (const line of (message ?? '(no draft — your editor will open)').split('\n')) {
      console.log(`       | ${line}`.trimEnd());
    }
  }
  if (pending) console.log(`  ${++step}. commit [Release] ${tag}: ${RELEASE_FILES.join(', ')}`);
  console.log(`  ${++step}. tag ${tag}`);
  if (!args.noPush) {
    console.log(`  ${++step}. push ${BRANCH} and ${tag} to ${REMOTE} — this publishes to npm`);
  }

  const skipped = leftOut(pending);
  if (skipped.length) {
    console.log('\nNot in this release:');
    for (const line of skipped) console.log(`  ${line}`);
  }

  const edit = args.yes ? false : await confirm(message !== null);

  if (env) {
    const command = ['commit', '--quiet'];
    if (message !== null) {
      writeFileSync(messagePath, `${message}\n`);
      command.push('-F', messagePath);
    }
    if (edit || message === null) command.push('-e');
    if (!attached(command, { env })) fail('the staged work was not committed — nothing was written');
    console.log(`\n  ${commitSummary()}`);
  }

  if (pending) {
    // A pathspec commits exactly these files, from the working tree, whatever else is
    // or is not staged.
    if (!attached(['commit', '--quiet', '-m', `[Release] ${tag}`, '--', ...RELEASE_FILES])) {
      fail('the release commit failed. Fix it, then rerun npm run release-git');
    }
    console.log(`  ${commitSummary()}`);
  }

  git(['tag', tag]);
  console.log(`  tagged ${tag}`);
  push(tag, args.noPush);
}

await main();
