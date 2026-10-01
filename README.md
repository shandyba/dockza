<p align="center">
  <img src="https://raw.githubusercontent.com/shandyba/dockza/main/assets/icon.png" alt="dockza" width="180">
</p>

<h1 align="center">dockza</h1>

<p align="center">
  A lightweight terminal UI for Docker. Manage containers, images, volumes, and networks from your terminal — Compose-aware, no mouse required.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dockza.app"><img src="https://img.shields.io/npm/v/dockza.app" alt="npm version"></a>
  <a href="https://github.com/shandyba/dockza/actions/workflows/ci.yml"><img src="https://github.com/shandyba/dockza/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/node/v/dockza.app" alt="Node"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
</p>

<!-- TODO: record a new asciicast under the dockza name and link it here. -->

## Install

Run it without installing:

```bash
npx dockza.app
```

Or install globally:

```bash
npm install -g dockza.app
dockza
```

> **Note on the name.** The npm package is published as **`dockza.app`**, matching
> the project homepage — the plain `dockza` name is rejected by npm's automated
> typosquatting filter for being too close to an unrelated existing package.
> Only the install command carries the suffix; once installed, the executable is
> just `dockza`.

## Features

- **Compose-aware Stacks view** — containers grouped by project with running / errored / stopped counts, collapsible per stack. Stop, start, restart or kill a whole stack, or take it down (`compose down`, with or without `-v`).
- **Containers / Images / Volumes** — live CPU and memory stats, start / stop / restart / kill / remove with confirm dialogs. Removing a container can take its anonymous volumes with it (`rm -v`).
- **Networks** — list Docker networks with driver, scope, the containers attached, creation time, and in-use status; remove unused networks (built-in networks and any with attached containers are protected).
- **Detail panel** — full metadata, live CPU/MEM bars, the image and compose stack a container belongs to, its published ports, the networks it is on with its address and DNS names, mounts with the volume each one comes from, the containers it depends on, and environment variables you can browse, expand to their full value, and copy to the clipboard.
- **Everything links** — containers, images, volumes, networks and compose stacks each have a detail, and each names the others it relates to: a container's image and stack, an image's or a network's containers, a stack's services, volumes and networks, a container's `depends_on`. `Enter` on any of them opens it; `[` comes back.
- **Outdated and orphaned** — an orange `↑` marks a container whose image tag now points at a newer image, and `○ orphaned` a volume or network left behind by a compose project that has no containers any more.
- **Back / forward** — `[` and `]` walk through the screens you visited, links followed included.
- **Streaming log viewer** with follow mode, scrollback cap, and color-coded stdout/stderr.
- **Filter as you type** — press `/` on any list and it narrows with every key, ignoring case: stacks by stack or service, containers by name, image, ID or project, images by repository, tag or ID, volumes and networks by name or driver. `↑ ↓` walk the matches while you type, `Enter` keeps the filter for the list's own keys, `Esc` clears it.
- **Side rail navigation** — `1`–`5` or `Tab` cycles views; click a live stack to jump to it.
- **Help overlay** — press `h` anywhere (except in a confirm dialog or while typing a filter) to toggle the key-binding reference.
- **Shell into containers** — `x` opens an external terminal `exec`'d into the selected container (macOS Terminal, Windows Terminal, common Linux emulators).
- **Honors `DOCKER_HOST`** — works with rootless Docker, podman, and remote daemons.

## Requirements

- Node.js **24** or later
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

### Clipboard

Copying uses your platform's clipboard tool: `pbcopy` on macOS, `clip.exe` on Windows and WSL, `wl-copy` (from `wl-clipboard`) on Wayland, `xclip` or `xsel` on X11, and `termux-clipboard-set` on Termux. Inside tmux, dockza also loads the text into tmux's paste buffer.

Over SSH, or when none of those tools works, dockza falls back to an OSC 52 escape sequence, which asks your terminal to set the clipboard. Most modern terminals support it (kitty, WezTerm, Alacritty, foot, Windows Terminal, and iTerm2 once *Applications in terminal may access clipboard* is enabled). Inside tmux, it needs `set -g set-clipboard on`. Some terminals cap the size of an OSC 52 copy, so very large values may not arrive that way. The footer says "via terminal (OSC 52)" whenever this path was used.

## Key bindings

### Global

| Key | Action |
|-----|--------|
| `1` – `5` | Jump to Stacks / Containers / Images / Volumes / Networks |
| `Tab` / `Shift+Tab` | Cycle views (in a detail panel: move between its sections) |
| `[` / `]` | Back / forward through the screens you visited (also `Alt+←` / `Alt+→` where the terminal sends them) |
| `h` | Toggle help overlay |
| `q` / `Ctrl+C` | Quit |

### Filter (every list)

| Key | Action |
|-----|--------|
| `/` | Filter the list as you type, ignoring case — the query shows in the list's bottom border with a match count |
| `↑ ↓` / `PgUp PgDn` / `Home End` | While typing: move the cursor through the matches |
| `Enter` | Keep the filter and go back to the list: its keys act on the matches |
| `Esc` | Clear the filter (while typing, or on the list) |
| `Ctrl+U` / `Ctrl+W` | Erase the whole query / its last word |

Each view keeps its own filter while you switch views. A link or `[` / `]` to a row the filter hides clears it.

### Stacks

| Key | Action |
|-----|--------|
| `↑ ↓` / `j k` | Navigate tree |
| `→` / `←` | Expand / collapse stack |
| `Enter` | On a stack: open the stack's detail. On a service: open the container's detail |
| `l` | Open log viewer |
| `x` | Shell into selected running container |
| `s` | Stop the stack or running container — the dialog also offers to remove it, keeping or deleting volumes (below) |
| `r` / `k` | Restart / kill the stack or running container (confirm) |
| `S` | Start a stopped container, or a stack's stopped services, dependencies first |
| `d` | Take the stack down, or remove a stopped container — keeping or deleting volumes (confirm) |

On a stack header, and over a stack's detail, the keys act on the whole stack. `(no stack)` is not a compose project, so it has no stack actions.

### Containers

Same per-container actions as Stacks. `Enter` always opens the detail panel.

### Stopping and removing

Stopping never deletes anything. Only removing does, and `-v` is the part that deletes data. The dialog behind `s` lists every way, with the safest on `y`. The dialog behind `d` lists the removing ones:

| Key in the dialog | Container | Stack |
|---|---|---|
| `y` (`s` dialog) | **Stop** (`docker stop`): the container and its data stay | **Stop** (`docker compose stop`): its containers and data stay |
| `d` | **Remove** (`docker rm`): the container goes, its volumes stay | **Down** (`docker compose down`): its containers and networks go, its volumes stay |
| `v` | **Remove -v** (`docker rm -v`): its anonymous volumes go too — named volumes never do | **Down -v** (`docker compose down -v`): the volumes its project created, and its containers' anonymous ones, go too |

A stack stops dependents first and starts dependencies first, as compose does. Networks and volumes another container still uses are kept, and the dialog says so. External volumes and networks are never touched. Stack actions use the Docker API, so they need no `docker` CLI and work against remote daemons too.

### Detail panel

Same container actions as the list/tree (`l`, `s`, `r`, `k`, `S`, `d`, `x`); a stack's detail takes the stack's (`s`, `r`, `k`, `S`, `d`). Plus:

| Key | Action |
|-----|--------|
| `Tab` / `Shift+Tab` | Put the cursor on the next / previous section, in the order shown, then none |
| `Enter` | On a link: open the image, stack, network, volume or container it names |
| `e` | Show / hide environment variables |
| `y` | Copy menu (below) |
| `↑ ↓` / `PgUp PgDn` / `Home End` | Scroll |
| `Esc` | Close |

A container's detail has these sections, in `Tab` order:

- **RELATED** — the image it runs and the compose stack it belongs to. When a newer image carries the tag it was created from, the image row says so.
- **PORTS** — each exposed port, where it is published on the host, and the URL to reach it.
- **NETWORKS** — each network it is on, its address there (none while it is stopped), and the DNS names other containers resolve it by.
- **MOUNTS** — each mount's type, where it comes from (a volume's name, or a bind's host path), and where it's mounted.
- **DEPENDS ON** — the other containers it relates to, both ways round: compose's `depends_on` (`depends on` / `needed by`), a shared network stack (`--network container:`), and borrowed volumes (`--volumes-from`).
- **ENV** — environment variables. ENV stays open when the cursor moves on; `e` hides it.

With the cursor on a section, `↑ ↓` select a row and `Enter` opens what it names in its own view — an image, a stack, a network, a volume, another container. `[` comes back.

While the cursor is on the environment variables, the arrow keys select a variable instead of scrolling:

| Key | Action |
|-----|--------|
| `↑ ↓` | Select a variable (past the first / last one, scroll the panel) |
| `PgUp PgDn` / `Home End` | Move the selection a page / to either end |
| `Enter` | Toggle the selected variable's full value (long and multi-line values are truncated until expanded) |
| `→` / `←` | Expand / collapse the selected value |
| `E` | Expand all values, or collapse them all |

### Copy menu (`y`)

It copies from the row the cursor is on, or, with no section selected, from the panel's subject itself. A letter means the same thing in every menu: `n` a name, `i` an ID, `y` the full form you would type (`NAME=value`, a `-v` or `-p` spec), `a` all of the rows.

| Where | Keys |
|-------|------|
| Container, nothing selected | `n` name · `i` ID · `m` image · `a` all variables |
| Image, nothing selected | `n` first tag · `i` ID · `t` all tags, one per line · `a` all user names |
| Volume, nothing selected | `n` name · `p` mountpoint · `a` all user names |
| Network, nothing selected | `n` name · `i` ID · `s` subnet(s) · `g` gateway(s) · `a` all user names |
| Stack, nothing selected | `n` project · `f` compose file(s) · `w` working dir · `a` all service names |
| A variable | `n` name · `v` value · `y` `NAME=value` · `a` all variables, `NAME=value` one per line |
| A RELATED image row | `n` image name · `i` image ID · (a volume's) `d` the `VOLUME` path |
| A RELATED stack row | `n` project · (a container's) `f` compose file(s) · `w` working dir |
| A port | `u` URL · `y` the binding as a `docker run -p` spec · `a` all of them |
| A container's network | `n` network name · `p` IP address · `d` DNS names · `a` all network names |
| A mount | `n` volume name · `s` source path (a bind's host path) · `d` path in the container · `y` the mount as a `docker run -v` spec · `a` all of them |
| A DEPENDS ON row | `n` container name · `i` container ID · `a` all names |
| A volume's USED BY row | `n` container name · `i` container ID · `d` path in the container · `y` `-v` spec · `a` all user names |
| An image's USED BY row | `n` container name · `i` container ID · `a` all user names |
| A network's USED BY row | `n` container name · `i` container ID · `p` IP address · `d` DNS names · `a` all user names |
| A stack's SERVICES row | `n` container name · `i` container ID · `m` image · `a` all container names |
| A stack's VOLUMES row | `n` volume name · `p` mountpoint · `a` all volume names |
| A stack's NETWORKS row | `n` network name · `i` network ID · `s` subnet · `a` all network names |

`Esc` cancels. Options that don't apply (a bind mount has no volume name, an unpublished port has no URL) are shown greyed out with the reason.

On Docker Desktop a bind's source is reported as `/host_mnt/…`; dockza shows and copies the host path without that prefix.

### Log viewer

| Key | Action |
|-----|--------|
| `Enter` | Open the container's detail (`[` comes back to the logs) |
| `f` | Toggle follow mode |
| `g` | Scroll to top |
| `G` | Scroll to bottom, re-enable follow |
| `↑` / `k` | Scroll up (disables follow) |
| `Esc` | Close |

### Images, Volumes & Networks

| Key | Action |
|-----|--------|
| `↑ ↓` / `j k` | Navigate list |
| `Enter` | Open the item's detail |
| `d` | Delete unused item (confirm), also from its detail |

Each list's USED BY column names the containers using the item, running or stopped (`+N` for more): those created from an image, mounting a volume, or attached to a network.

- **An image's detail** lists all its tags (the TAG column shows the first and `+N`) and the containers created from it. An image whose tag has since moved on to a newer one says `superseded by <tag>`.
- **A volume's detail** shows its mountpoint and, under RELATED, where it came from: its compose stack, or that it is anonymous — and, while a container uses it, the image whose `VOLUME` it was made for. Docker keeps no record of the containers that used a volume before, so an unused volume shows only what its labels say.
- **A network's detail** shows its subnets and gateways, its compose stack, and each attached container with its address and DNS names.
- **A stack's detail** (`Enter` on a stack in the Stacks view) shows its compose file(s) and working directory, its services, and the volumes and networks its project created.

`Tab` then `Enter` on a row opens what it names. A volume or network whose compose project has no containers left reads `○ orphaned`, and its detail says so instead of linking to a stack.

Networks additionally protect the built-in `bridge` / `host` / `none` networks and any network with attached containers — `d` on those shows a message instead of a confirm dialog. In-use detection is consistent with Images and Volumes: a network counts as in use whenever a container is attached, running or stopped.

### Confirm dialog

| `y` / `Y` to confirm · `d` / `v` where the dialog offers them · `n` / `N` / `Esc` to cancel |
|-----------------------------------------------------------------------------------------------|

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
