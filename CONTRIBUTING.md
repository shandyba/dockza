# Contributing to dockza

Thanks for taking the time to help out. The project is small and the surface area is intentionally narrow — issues and PRs of any size are welcome.

## Getting set up

```bash
git clone https://github.com/shandyba/dockza.git
cd dockza
npm install
npm run dev
```

You'll need a running Docker daemon to exercise changes against real containers, images, and volumes. A few stacks running via `docker compose up` give the Stacks view something interesting to render.

## Project layout

```
src/
  cli.ts                  Entry point. Boots App, owns the only process.exit().
  theme.ts                Color palette (C) + tag helpers (t.purple(...), etc.).
  docker/                 Dockerode wrappers. Pure transformations live alongside.
  models/docker.ts        Shared types: ContainerInfo, ImageInfo, VolumeInfo, ...
  utils/                  Pure helpers: format, stats, status, stacks, term-caps.
  ui/                     neo-blessed widgets.
    app.ts                Screen, polling loop, view routing, global keys.
    widgets.ts            Shared factories + Dims interface.
    resource-list-tab.ts  Shared base for the simple list views.
    top-bar.ts            One-row header (socket, version, counters, stats).
    footer.ts             One-row context-aware key hints + last-refresh ticker.
    side-rail.ts          28-col left rail: views + live stacks.
    help-overlay.ts       Help modal toggled with `h`.
    stacks/               Stacks view + stack tree.
    containers/           Containers tab, detail panel, log viewer, confirm dialog.
    images/               Images tab.
    volumes/              Volumes tab.
    networks/             Networks tab.
tests/                    Vitest tests parallel to src/. Pure logic only.
```

Imports use TypeScript path aliases (`@docker/*`, `@ui/*`, `@utils/*`, `@models/*`, `@theme`) configured in `tsconfig.json` and rewritten to relative paths at build time by `tsc-alias`. Prefer the alias over deep `../../` paths.

## Coding conventions

- **TypeScript strict** mode. Avoid `any` outside the dockerode-narrowing edge — when you do need it, add `// eslint-disable-next-line @typescript-eslint/no-explicit-any` with a comment explaining why.
- **One primary export per file**, named (not default). No `index.ts` barrels.
- **File names**: `kebab-case.ts` (e.g. `container-list.ts`, `status-bar.ts`).
- **Async** functions wrap their bodies in `try` / `catch` and rethrow with a human-readable message — never swallow errors silently.
- **`process.exit()`** is only allowed in `src/cli.ts`. Inside widgets, signal shutdown through events.
- **`screen.render()`** is the caller's responsibility, not the widget's — except inside the widget's own key handler responding to user input.
- **Colors** always come from `src/theme.ts` (the `C` object or `t.<color>` helpers). Never hardcode hex tags inline.
- **Status-driven coloring** for containers goes through `src/utils/status.ts` (`statusDot`, `statusLabel`, `colorByStatus`, `isActive`, `cpuColor`, `memColor`, `formatCpuCell`, `formatMemCell`).
- **Shared widget factories** in `src/ui/widgets.ts` (`createListWidget`, `createHeaderBar`, `createCenteredMessage`, `listSelected`) — use them instead of re-rolling `blessed.list` config.
- **Key handlers** registered with `screen.key()` when a widget is shown **must** be removed with `screen.removeKey()` when it hides — otherwise they leak across views.
- **Tabs never fetch.** `src/ui/app.ts` is the only module that imports `list*` from `@docker/*`; it owns every listing and pushes results in through `setData`. Mutations go through the `RunMutation` callback App injects into each tab, which invalidates in-flight polls (via `src/utils/refresh-gate.ts`) and refetches — otherwise a poll that straddles the mutation writes its pre-mutation snapshot back over the result. `grep -rn "listContainers\|listImages\|listVolumes\|listNetworks" src/ui` must match only `app.ts`.

## Tests

Vitest, with `tests/` mirroring `src/`. We test:

- Pure functions (`format`, `stats`, `status`, `stacks`, `term-caps`).
- Pure transformations from dockerode payloads (`toContainerInfo`, `toContainerStats`).

We intentionally **do not** test blessed widgets (they need a real terminal) or thin try/catch shells around dockerode IO (testing them tests the mock). When you add a new pure utility, add tests next to it.

The one deliberate exception is `tests/ui/resource-list-tab.test.ts`: the stale-poll regression it guards lives in the seam between a tab and App's poller, so it has to drive a real tab. It builds the screen with injected `PassThrough` streams (`isTTY`, explicit `columns`/`rows`, stubbed `setRawMode`) — under a pipe blessed reports 1×1 and layout-dependent code degenerates. Keep new widget tests to that bar: only when the behaviour cannot be reached from a pure unit.

```bash
npm test               # one-shot
npm run test:watch     # while iterating
npm run test:coverage  # writes ./coverage/index.html
```

Coverage thresholds are enforced in CI (see `vitest.config.mts`). Bump them as you raise the floor — don't lower them to make a red build green.

## Pre-PR checklist

These are exactly what CI runs. If they pass locally they pass in CI:

```bash
npm run lint
npm run format:check
npm test
npm run build
```

`format:check` fails on style drift — run `npm run format` to auto-fix.

## Submitting a pull request

1. Fork and create a feature branch off `main`.
2. Keep the diff focused — one logical change per PR. If your branch grows tendrils, split it.
3. **Don't edit [`CHANGELOG.md`](./CHANGELOG.md).** Release notes are written at release time from the full diff since the last tag (see [Releasing](#releasing)), and `[Unreleased]` is rewritten wholesale each time — so a hand-written entry there would be discarded. Instead, describe the user-visible impact in your PR description; that is what the release notes are drawn from.
4. If the change adds a new dependency, explain why in the PR description — we keep the dep tree small on purpose.
5. Open the PR. Describe **what** changed and **why** (the code shows the what; the why is what reviewers need).
6. CI must be green before merge.

## Commit messages

No strict convention enforced, but short imperative subjects help (`fix log-viewer race on close`, `add isConfirmOpen to ImagesTab`, `remove deprecated heartbeat scaffolding`). Reference issues with `Fixes #N` where applicable.

## Releasing

Maintainer-only. `CHANGELOG.md` is the single source of truth: the npm release, the GitHub Release page and any future site listing are all derived from it, so nothing ships without notes.

**1. Write the notes.** Rewrite the `[Unreleased]` section from the full diff since the last release tag, following the house style below:

```bash
git log --format='%h %s' "$(git describe --tags --abbrev=0)..HEAD"
git diff "$(git describe --tags --abbrev=0)..HEAD" -- . ':!package-lock.json' ':!coverage' ':!dist'
```

**2. Promote and tag:**

```bash
npm run release 0.2.4           # dates the section, rewrites link refs, bumps both manifests
git commit -am "[Release] v0.2.4"
git tag v0.2.4 && git push origin main v0.2.4
```

Push both refs explicitly. `git push --follow-tags` pushes *annotated* tags only, and these are lightweight — it skips them and still exits 0, so the release silently never starts.

CI then verifies the tag matches `package.json`, verifies `CHANGELOG.md` has a non-empty section for that version, publishes to npm, and creates the GitHub Release using that section as the body.

**`[Unreleased]` is derived, not accumulated.** It is rewritten wholesale from `<latest tag>..HEAD` each time rather than appended to, which is why it cannot drift out of date the way it did at 0.2.2 and 0.2.3 — both of which shipped to npm with no changelog entry at all. Rewrite it whenever you want to see what is pending.

**If the gate fails**, the tag already exists but nothing was published. Delete it, fix the changelog, re-tag:

```bash
git tag -d v0.2.4 && git push --delete origin v0.2.4
```

Useful directly:

```bash
npm run release 0.2.4 --dry-run   # preview the promotion, write nothing
npm run changelog 0.2.3           # print one section (what CI gates on)
```

### House style for changelog entries

Group by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) category — `Fixed`, `Security`, `Changed`, `Added`, `Removed`, `Deprecated` — omitting any that are empty. Each entry opens in bold with the user-visible symptom, then gives the cause and the fix.

**Keep entries short.** One sentence is the default. Two when cause and fix both need saying, three only for a regression with real blast radius. Budget roughly 40 words; 60 is the ceiling. A patch release's whole section should be scannable in about fifteen seconds — someone deciding whether to upgrade, not someone debugging.

A trivial fix is one clause:

> - **Top-bar counters ran into their status dots** — `●7` now renders as `● 7`.

A real regression still fits in three sentences:

> - **Deleted rows came back.** A background poll straddling the deletion wrote its stale snapshot over the fresh list, so removed images, volumes and networks reappeared for a moment — and stopped containers flipped back to `running`. Listings now carry a generation token, so an outraced response is discarded.

Cut, in roughly this order:

- **The second telling.** Describing the symptom in user terms and then again in code terms is the most common way these double in length. Pick one.
- **Mechanism beyond one clause.** "A poll straddling the deletion wrote a stale snapshot back" is the whole explanation; the reader debugging it has the commit.
- **Exhaustive enumeration** of every affected view, file or function once the pattern is clear.
- **Hedges and qualifications** — "rather than known to be broken", "so behaviour is no longer verified". State the fact or drop it.
- **Anything about what you didn't change**, considered, or tested.

Entries in sections 0.1.0–0.2.3 run considerably longer than this; treat them as the model for *voice*, not for length.

What separates this changelog from a commit log:

- **Lead with the symptom, not the change.** "Deleted rows came back", not "added a generation token to the refresh gate". The reader is a user deciding whether to upgrade.
- **One narrative per user-visible problem, not one per commit.** Three commits fixing one race is one entry. A commit that only refactors is no entry at all.
- **Say who was affected and how badly** where the code supports it — "every user with a portless container", "anyone following the npm install instructions verbatim". Don't guess at blast radius the diff doesn't show.
- **Note the affected version range** when a bug predates the current release.
- **Mechanism, briefly** — enough that a reader understands why it happened, not a code tour.
- Purely internal work (tests, CI, refactors) goes under `### Project meta`, and only when genuinely notable.
- Never write roadmap items, "coming soon", or anything the diff doesn't support.
- Match the surrounding prose: em dashes, inline code for identifiers, `GiB`/`MiB` sizes, `4d 2h` uptimes.

Useful directly:

```bash
npm run release 0.2.4 --dry-run   # preview the promotion, write nothing
npm run changelog 0.2.3           # print one section (what CI gates on)
```

## Reporting bugs

Open an issue at [github.com/shandyba/dockza/issues](https://github.com/shandyba/dockza/issues) with:

- Your OS and Node.js version (`node --version`)
- Your Docker version (`docker version`)
- The exact command you ran (e.g. `npx dockza.app@0.2.0`)
- Steps to reproduce
- What you expected vs. what happened
- Any error message from stderr, verbatim

Terminal recordings (asciinema, vhs) or screenshots are extremely helpful for layout, color, or interaction bugs.

## Suggesting features

Open an issue using the **Feature request** template before writing code for anything beyond a small fix. It saves both sides time if the idea isn't a fit — dockza is intentionally a focused tool, not a full Docker Desktop replacement.

## License

By contributing you agree that your contributions are licensed under the project's [MIT License](./LICENSE).

dockza is a fork of [docktui](https://github.com/0xShady/docktui) by Achraf El Fadili, continued independently under a new name. See [NOTICE](./NOTICE) for the full attribution and third-party licenses. Please open issues and pull requests here rather than upstream.
