# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.3] - 2026-10-01

### Changed

- **`s` asks how far to go.** Stop stays on `y`; `d` and `v` in the same dialog remove the
  container or take the stack down, keeping or deleting its volumes. A running container
  is stopped gracefully before it is removed.

### Added

- **Act on a whole compose stack.** On a stack header or over its detail, `s`, `S`, `r`
  and `k` stop, start, restart or kill every service — dependencies start first and stop
  last, as compose does.
- **Take a stack down.** `d` removes its containers and networks like
  `docker compose down`, and `v` deletes its volumes too, as `down -v` does. Networks and
  volumes another container still uses are kept.
- **Remove a container with its anonymous volumes.** `v` in the remove dialog runs
  `docker rm -v`; named volumes are never deleted.

## [0.3.2] - 2026-10-01

### Added

- **Every list filters as you type.** `/` now works in all five views, not just Stacks,
  and narrows the list with each key; `Enter` keeps the filter so the view's keys act on
  the matches, and `Esc` clears it.
- **Filters look past the name.** Containers and services also match on image, ID and
  compose project; images on their ID and every tag, not just the one listed; volumes and
  networks on driver and project.

## [0.3.1] - 2026-10-01

### Fixed

- **A port published on all interfaces was listed twice** — since 0.1.0. Docker reports
  it on both `0.0.0.0` and `::`; dockza now shows it once, and sorts ports so they stop
  reshuffling between polls.
- **An image pulled by digest showed a mangled name** — since 0.1.0. Docker's containerd
  image store lists it as `repo@sha256:…`, which read as repository `repo@sha256`; it now
  splits at the `@`.

### Changed

- **`Enter` on a stack opens its detail** instead of expanding or collapsing it — `→` /
  `←` still do that.

### Added

- **Images, networks and stacks get a detail panel.** `Enter` opens one: an image's tags
  and the containers created from it; a network's subnets, gateways and attached
  containers, with their addresses and DNS names; a stack's compose files, services,
  volumes and networks.
- **A container's detail shows what it connects to:** its image and stack, published
  ports with a URL for each, its address and DNS names on each network, and the
  containers it relates to through `depends_on`, `--network container:` or
  `--volumes-from`, both ways round.
- **Every reference is a link.** `Enter` on any of those rows opens the image, stack,
  network, volume or container it names, and `[` comes back.
- **Lists say who uses what.** The Images and Networks lists gain a USED BY column,
  replacing the Networks list's container count, and the NET, PORTS and TAG columns add
  `+N` where there is more than the one shown.
- **Containers running an outdated image are marked.** An orange `↑` flags a container
  whose image tag now points at a newer local image, where the list used to show a bare
  image ID; the image's detail says `superseded by <tag>`.
- **Leftovers of removed compose projects are marked.** A volume or network whose
  project has no containers left reads `○ orphaned`.
- **An anonymous volume's detail names the image that created it**, from the `VOLUME`
  a container mounts it at — so only while one does.
- **`Enter` in the log viewer opens the container's detail**; `[` returns to the logs.
- **More to copy.** `y` adds a port's URL or `-p` spec, a container's address and DNS
  names on a network, an image's tags, a network's subnets and gateways, and a stack's
  compose files and working directory.

## [0.3.0] - 2026-10-01

### Fixed

- **Mount sources were blank or pointed inside Docker Desktop's VM** — since 0.1.0. An
  anonymous volume showed no source and a bind read `/host_mnt/…`; MOUNTS now names each
  volume and shows a bind's host path.

### Added

- **See which containers use a volume.** The Volumes list gains a USED BY column, and
  `Enter` opens a volume's detail: its mountpoint, where it came from (a compose project,
  or anonymous), and every container mounting it, running or stopped.
- **Follow a mount to its volume, and a volume to its containers.** `Tab` moves the
  cursor between a detail panel's sections, and `Enter` on a mount or a USED BY row opens
  the volume or container it names.
- **Back and forward through the screens you visited.** `[` and `]` (or `Alt+←` /
  `Alt+→`) step through them, followed links included, returning to the row and section
  the cursor was on.
- **More to copy from a detail panel.** `y` copies from the selected row, or with none
  selected from the panel's subject: a container's name, ID or image; a mount's source,
  destination or `docker run -v` spec; a volume's name or mountpoint.

## [0.2.6] - 2026-10-01

### Fixed

- **Keys typed while help was open acted on the view behind it** — since 0.1.0. `S`
  started the selected container, `x` opened a shell, `d` raised a hidden "Remove
  container?" confirm, and Esc closed the detail panel instead of the help. Help now
  holds the keyboard until it closes.
- **The footer fell back to list hints over an open detail panel or log viewer** — since
  0.1.0. Every poll re-sent the list selection, replacing the panel's key hints within
  seconds; they now stay until the panel closes.

### Added

- **Environment variables can be browsed and read in full.** `e` used to list them with
  values cut at 55 characters; now `↑`/`↓` select a variable and `Enter` expands it to
  its full value, multi-line ones included (`E` expands all).
- **Copy environment variables to the clipboard.** `y` in the detail panel copies the
  selected variable's name, value or `NAME=value`, or all of them. It uses the
  platform's clipboard tool, or over SSH an OSC 52 escape to the terminal — see the
  README's Clipboard section.

## [0.2.5] - 2026-09-11

### Fixed

- **The selected row was all but invisible.** Its indigo highlight snapped to near-black
  `#1c1c1c` under blessed's 256-colour matching, barely a shade off the background — in
  every list view, and since 0.1.0. Lists now highlight on an indigo that survives the
  match.

### Changed

- **Services now sit indented under their stack.** Every service row started in the stack
  name's own column, leaving the elbow as the only cue that it was nested. Service rows
  now step three columns right — `├─` on each, `└─` on the last — taking the width out of
  the image column.

## [0.2.4] - 2026-09-11

### Fixed

- **Top-bar counters ran into their status dots.** The running and errored counts in
  the top right rendered as `●7` and `●1`, with no gap between the coloured dot and
  the number. Both now carry a space, matching the stopped counter, which has no dot.

## [0.2.3] - 2026-09-04

### Changed

- **Node.js 24 is now the minimum.** `engines.node` moves from `>=20` to `>=24`, and
  CI drops its Node 20 and 22 legs — the matrix is now Node 24 across Ubuntu, macOS
  and Windows. Nothing in the source requires 24 specifically; the bump aligns the
  supported range with what CI actually exercises, so behaviour on 20 and 22 is no
  longer verified rather than known to be broken. npm warns instead of refusing on an
  engine mismatch, so existing installs on older Node keep running untested.
  `@types/node` moves 20.x → 24.x to match, and the README requirement is updated.

## [0.2.2] - 2026-09-04

### Fixed

- **Deleted rows came back.** Removing an image (and likewise a volume or network)
  made the row vanish and then reappear a few hundred milliseconds later, even
  though Docker had really deleted it; it stayed on screen until the next poll.
  A background poll issued *before* the deletion landed *after* it and wrote its
  pre-delete snapshot over the fresh list. The same race hit container actions on
  the Containers and Stacks views, where a stopped container would flip back to
  `running` for a few seconds. Listings are now owned solely by the polling loop
  and carry a generation token, so a response a mutation has outraced is discarded
  instead of applied.
- **Side-rail and top-bar counters desynced from the list after any action.** The
  rail could report N images while the list showed N-1, and stopping a container
  from the Stacks view recomputed the top-bar running/stopped/errored counts from
  a stale container array — producing numbers that were wrong, not merely late.
  A mutation now refreshes the list, both container views and every counter together.
- **Resizing the terminal could undo a container action.** The Containers list was
  repainted on resize from a cache the action never updated, so a removed container
  reappeared when the window changed size.

## [0.2.1] - 2026-09-02

### Fixed

- **Install instructions in the published package were wrong.** The 0.2.0
  tarball shipped a README telling users to run `npx dockza` and
  `npm install -g dockza` — neither of which resolves, because the package is
  published as `dockza.app`. The npm version badge pointed at the same
  nonexistent package. Anyone landing on the npm page and following it verbatim
  got a failed install. Corrected to `dockza.app`, with a note clarifying that
  the installed executable remains `dockza`.

### Changed

- Releases now publish from CI via npm [trusted publishing](https://docs.npmjs.com/trusted-publishers/)
  (OIDC) instead of a long-lived `NPM_TOKEN`, so published tarballs carry a
  provenance attestation linking them to the exact commit and workflow run that
  built them. The release workflow moves to Node 24 (OIDC needs npm ≥ 11.5.1)
  and skips publishing when the tagged version is already on the registry.

## [0.2.0] - 2026-08-28

First release under the name **dockza**. This project is a fork of
[docktui](https://github.com/0xShady/docktui) v0.1.1 by Achraf El Fadili,
continued independently after upstream development stopped. See
[NOTICE](./NOTICE) for full attribution.

### Fixed

- **Crash on startup when any container publishes no ports.** The daemon sends
  `Ports: null` (rather than `[]`) for such containers, and `toContainerInfo`
  mapped over it unguarded — so `listContainers` threw
  `Cannot read properties of null (reading 'map')` and the Stacks and Containers
  views showed nothing but the error. `Ports`, `NetworkSettings.Networks` and
  `Names` are now all null-tolerant. This affected every user with a portless
  container; it predates the fork and was present throughout 0.1.x.

### Security

- Bumped `dockerode` 4.0.2 → 5.0.1, clearing all known advisories in the
  dependency tree (2 high in `protobufjs`, 2 moderate in `uuid`; `npm audit`
  now reports zero, with and without dev dependencies). dockerode 5.0.0's only
  breaking changes are dropping its `uuid` dependency and raising the minimum
  Node version, both of which this project already satisfies. `@types/dockerode`
  moves 3.3.x → 4.0.x to match.

### Changed

- **Renamed `docktui` → `dockza`.** The binary, the window title, the header
  brand and the help-overlay title all now read `dockza`. Users of `docktui`
  should `npm uninstall -g docktui` and `npm install -g dockza.app`; there is no
  automatic migration path, but no configuration or state is carried between
  them, so nothing is lost.
- **The npm package is published as `dockza.app`, not `dockza`.** npm's
  automated typosquatting filter rejects the plain `dockza` name for being too
  similar to the unrelated `docz` package, so the published name matches the
  project homepage instead. This affects the install command only — the
  executable installed on `PATH` is still `dockza`.
- Repository moved to [github.com/shandyba/dockza](https://github.com/shandyba/dockza);
  homepage is now [dockza.app](https://dockza.app).
- New logo and icon set under `assets/` (`logo.svg` plus generated PNG, square,
  favicon and apple-touch variants). The previous docktui logo has been removed
  and is not carried into this fork.
- `LICENSE` now carries the copyright notices of both the original author and
  the fork maintainer, as MIT requires. A `NOTICE` file records the fork's
  origin, the former name, third-party dependency licenses and trademark
  attributions, and ships in the npm tarball alongside `LICENSE`.

### Added

- **Networks view** — a fifth view (key `5`, beneath Volumes) listing Docker
  networks with driver, scope, short ID, attached-container count, creation
  time, and an in-use / unused status badge. Press `d` to delete an unused
  network (confirm dialog); built-in (`bridge` / `host` / `none`) networks and
  any network with attached containers are guarded against deletion, consistent
  with the Images and Volumes views (a network is in use whenever a container is
  attached, running or stopped). Attached-container counts are keyed by network
  name (the stable identifier a container stores; a stopped container's endpoint
  ID can go stale after a daemon restart), so the count agrees with the
  Containers view.

## [0.1.1] - 2026-05-24

Released upstream as `docktui`, before the fork.

### Changed

- Point `package.json` `homepage` at the new landing site
  ([docktui.com](https://docktui.com)) so the npm page links there
  instead of the GitHub README anchor.
- Swap the README hero image to the new PNG logo
  (`assets/icon.png`) and remove the old JPG.

## [0.1.0] - 2026-05-24

First public release on npm, as `docktui`.

### Added

- **Stacks view** — Docker Compose-aware tree, containers grouped by project, collapsible per stack, running / errored / stopped counts.
- **Containers, Images, Volumes views** with live CPU & memory stats, start / stop / restart / kill / remove actions, and confirm dialogs.
- **Side rail** — persistent navigation across the four views with live stack jump-to (keys `1`–`4`, `Tab` / `Shift+Tab`).
- **Filter** — `/` from the Stacks view filters by stack name, service name, or image.
- **Log viewer** with follow mode (`f`), scroll, top/bottom jumps, and a scrollback cap so chatty containers don't grow unbounded.
- **External terminal exec** — `x` shells into the selected running container via the platform's native terminal (macOS Terminal.app / Windows Terminal / common Linux emulators).
- **`DOCKER_HOST` support** — honors `unix://`, `npipe://`, `tcp://`, `http://`, `https://` for rootless docker, podman, and remote daemons.
- **Top bar** shows the socket path, Docker daemon version, and live aggregate counters.
- **Footer** shows context-aware key hints and "last refresh Ns ago".

### Project meta

- TypeScript strict mode, ESLint + Prettier, Vitest test suite (88 tests).
- CI runs lint, format check, build, and tests on Ubuntu / macOS / Windows × Node 20 / 22.
- npm tarball ships only `dist/` + `README.md` + `LICENSE` + `NOTICE` (~35 kB).

Releases 0.1.0 and 0.1.1 predate the fork and live in the upstream repository.

[Unreleased]: https://github.com/shandyba/dockza/compare/v0.3.3...HEAD
[0.3.3]: https://github.com/shandyba/dockza/releases/tag/v0.3.3
[0.3.2]: https://github.com/shandyba/dockza/releases/tag/v0.3.2
[0.3.1]: https://github.com/shandyba/dockza/releases/tag/v0.3.1
[0.3.0]: https://github.com/shandyba/dockza/releases/tag/v0.3.0
[0.2.6]: https://github.com/shandyba/dockza/releases/tag/v0.2.6
[0.2.5]: https://github.com/shandyba/dockza/releases/tag/v0.2.5
[0.2.4]: https://github.com/shandyba/dockza/releases/tag/v0.2.4
[0.2.3]: https://github.com/shandyba/dockza/releases/tag/v0.2.3
[0.2.2]: https://github.com/shandyba/dockza/releases/tag/v0.2.2
[0.2.1]: https://github.com/shandyba/dockza/releases/tag/v0.2.1
[0.2.0]: https://github.com/shandyba/dockza/releases/tag/v0.2.0
[0.1.1]: https://github.com/0xShady/docktui/releases/tag/v0.1.1
[0.1.0]: https://github.com/0xShady/docktui/releases/tag/v0.1.0
