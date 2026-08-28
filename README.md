<p align="center">
  <img src="https://raw.githubusercontent.com/shandyba/dockza/main/assets/icon.png" alt="dockza" width="180">
</p>

<h1 align="center">dockza</h1>

<p align="center">
  A lightweight terminal UI for Docker. Manage containers, images, volumes, and networks from your terminal — Compose-aware, no mouse required.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dockza"><img src="https://img.shields.io/npm/v/dockza.svg" alt="npm version"></a>
  <a href="https://github.com/shandyba/dockza/actions/workflows/ci.yml"><img src="https://github.com/shandyba/dockza/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/node/v/dockza.svg" alt="Node"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
</p>

<!-- TODO: record a new asciicast under the dockza name and link it here. -->

## Install

Run it without installing:

```bash
npx dockza
```

Or install globally:

```bash
npm install -g dockza
dockza
```

## Features

- **Compose-aware Stacks view** — containers grouped by project with running / errored / stopped counts, collapsible per stack.
- **Containers / Images / Volumes** — live CPU and memory stats, start / stop / restart / kill / remove with confirm dialogs.
- **Networks** — list Docker networks with driver, scope, attached-container count, creation time, and in-use status; remove unused networks (built-in networks and any with attached containers are protected).
- **Detail panel** — full metadata, mounts, environment, live CPU/MEM bars.
- **Streaming log viewer** with follow mode, scrollback cap, and color-coded stdout/stderr.
- **Filter** — press `/` from Stacks to filter by stack, service, or image name.
- **Side rail navigation** — `1`–`5` or `Tab` cycles views; click a live stack to jump to it.
- **Help overlay** — press `h` anywhere (except confirm dialogs / the stack filter) to toggle the key-binding reference.
- **Shell into containers** — `x` opens an external terminal `exec`'d into the selected container (macOS Terminal, Windows Terminal, common Linux emulators).
- **Honors `DOCKER_HOST`** — works with rootless Docker, podman, and remote daemons.

## Requirements

- Node.js **20** or later
- A running Docker daemon (Docker Desktop on macOS/Windows, Docker Engine on Linux, or any podman/rootless setup)
- A **256-color** or **truecolor** terminal (`TERM=xterm-256color` or `COLORTERM=truecolor`)

## Configuration

### Custom Docker host

dockza auto-detects the daemon socket. To point it elsewhere, set `DOCKER_HOST`:

```bash
DOCKER_HOST=unix:///run/user/1000/docker.sock dockza          # rootless docker
DOCKER_HOST=unix:///run/user/1000/podman/podman.sock dockza   # podman
DOCKER_HOST=tcp://10.0.0.5:2375 dockza                        # remote daemon
DOCKER_HOST=npipe:////./pipe/docker_engine dockza             # Windows named pipe
```

### Shell-into-container (`x` key)

Requires the `docker` CLI to be on your `PATH`. dockza launches your platform's native terminal with `docker exec -it <id> sh` (falls back to `bash` if available inside the container).

## Key bindings

### Global

| Key | Action |
|-----|--------|
| `1` – `5` | Jump to Stacks / Containers / Images / Volumes / Networks |
| `Tab` / `Shift+Tab` | Cycle views |
| `h` | Toggle help overlay |
| `q` / `Ctrl+C` | Quit |

### Stacks

| Key | Action |
|-----|--------|
| `↑ ↓` / `j k` | Navigate tree |
| `→` / `←` | Expand / collapse stack |
| `Enter` | On a stack: toggle expand. On a service: open detail panel |
| `/` | Open filter (`Esc` to clear) |
| `l` | Open log viewer |
| `x` | Shell into selected running container |
| `s` / `r` / `k` | Stop / restart / kill running container (confirm) |
| `S` | Start stopped container |
| `d` | Remove stopped container (confirm) |

### Containers

Same per-container actions as Stacks. `Enter` always opens the detail panel.

### Detail panel

Same container actions as the list/tree (`l`, `s`, `r`, `k`, `S`, `d`, `x`) plus:

| Key | Action |
|-----|--------|
| `e` | Toggle environment variables (expanded / collapsed) |
| `↑ ↓` | Scroll |
| `Esc` | Close |

### Log viewer

| Key | Action |
|-----|--------|
| `f` | Toggle follow mode |
| `g` | Scroll to top |
| `G` | Scroll to bottom, re-enable follow |
| `↑` / `k` | Scroll up (disables follow) |
| `Esc` | Close |

### Images, Volumes & Networks

| Key | Action |
|-----|--------|
| `↑ ↓` / `j k` | Navigate list |
| `d` | Delete unused item (confirm) |

Networks additionally protect the built-in `bridge` / `host` / `none` networks and any network with attached containers — `d` on those shows a message instead of a confirm dialog. In-use detection is consistent with Images and Volumes: a network counts as in use whenever a container is attached, running or stopped.

### Confirm dialog

| `y` / `Y` to confirm · `n` / `N` / `Esc` to cancel |
|-----------------------------------------------------|

## Troubleshooting

### `permission denied` on the Docker socket (Linux)

Add your user to the `docker` group, then log out and back in:

```bash
sudo usermod -aG docker $USER
```

### Windows: cannot connect to the daemon

By default dockza tries the named pipe `//./pipe/docker_engine`. If that fails, enable TCP in Docker Desktop (**Settings → General → Expose daemon on `tcp://localhost:2375` without TLS**) and run:

```bash
DOCKER_HOST=tcp://localhost:2375 dockza
```

### `dockza requires a 256-color (or truecolor) terminal`

Your `$TERM` is too narrow. Set it explicitly or use a modern terminal:

```bash
TERM=xterm-256color dockza
```

### `The 'docker' CLI is not on your PATH`

You hit `x` (shell into container) but the `docker` binary isn't installed or isn't on `PATH`. Install Docker CLI or skip the `x` action — everything else works without it.

## Development

```bash
git clone https://github.com/shandyba/dockza.git
cd dockza
npm install

npm run dev            # run from source with ts-node
npm run build          # compile to dist/
npm start              # run compiled output

npm test               # vitest, one-shot
npm run test:coverage  # generate ./coverage/index.html
npm run lint
npm run format
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the pre-PR checklist and [CHANGELOG.md](./CHANGELOG.md) for release history.

## Credits

dockza is a fork of [**docktui**](https://github.com/0xShady/docktui) by
[Achraf El Fadili](https://github.com/0xShady), released under the MIT License.
Upstream development appeared to have stopped, so this fork continues the work
independently under a new name. Every original commit and its authorship is
preserved in this repository's git history.

This project is not affiliated with, endorsed by, or supported by the original
author or the original project. Bug reports and feature requests belong
[here](https://github.com/shandyba/dockza/issues), not upstream.

Docker and the Docker logo are trademarks or registered trademarks of Docker,
Inc. dockza is an independent, unofficial tool and is not a Docker, Inc.
product.

## License

[MIT](./LICENSE) © Achraf El Fadili (original work) · © Dmytro Shandyba (fork and subsequent work)

See [NOTICE](./NOTICE) for attribution details and third-party licenses.
