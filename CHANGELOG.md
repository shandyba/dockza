# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-08-28

First release under the name **dockza**. This project is a fork of
[docktui](https://github.com/0xShady/docktui) v0.1.1 by Achraf El Fadili,
continued independently after upstream development stopped. See
[NOTICE](./NOTICE) for full attribution.

### Changed

- **Renamed `docktui` → `dockza`.** The binary, the npm package, the window
  title, the header brand and the help-overlay title all now read `dockza`.
  Users of `docktui` should `npm uninstall -g docktui` and
  `npm install -g dockza`; there is no automatic migration path, but no
  configuration or state is carried between them, so nothing is lost.
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
- npm tarball ships only `dist/` + `README.md` + `LICENSE` (~32 kB).

Releases 0.1.0 and 0.1.1 predate the fork and live in the upstream repository.

[Unreleased]: https://github.com/shandyba/dockza/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/shandyba/dockza/releases/tag/v0.2.0
[0.1.1]: https://github.com/0xShady/docktui/releases/tag/v0.1.1
[0.1.0]: https://github.com/0xShady/docktui/releases/tag/v0.1.0
