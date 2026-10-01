import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type blessed from 'neo-blessed';
import type { ContainerInfo } from '@models/docker';
import { ContainerDetail } from '@ui/containers/container-detail';
import { stripTags } from '@utils/format';
import { endpoint, makeContainer } from '../fixtures';
import { KEY, makeScreen, press } from './headless';

/**
 * We otherwise don't test blessed widgets (see CONTRIBUTING.md), but two things here only exist
 * against a real screen: the copy menu owning the keyboard (it must mute the tab's `screen.key`
 * handlers — a stray `k` is "kill container"), and blessed wrapping our pre-wrapped lines behind
 * our back, which would scroll the selection off screen. Keys are typed as raw bytes so blessed's
 * real parser and its `grabKeys` routing are what's under test.
 */

// Comfortably wider than the 100-column test screen, so it is always truncated until expanded.
const LONG_PATH =
  'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/lib/postgresql/18/bin:/opt/tools/bin:/home/app/.local/bin';
const PATH_VALUE = LONG_PATH.slice('PATH='.length);

function container(env: string[], extra: Partial<ContainerInfo> = {}): ContainerInfo {
  return makeContainer({
    id: 'b5322c040ce6aaaaaaaa',
    name: 'db-pr02',
    image: 'postgres:18',
    imageName: 'postgres:18',
    status: 'exited',
    uptime: 'a day ago',
    env,
    pids: 0,
    ...extra,
  });
}

/** Lets the copy promise chain (fire-and-forget inside the panel) finish. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
}

const content = (d: ContainerDetail): string => (d.box as any).content as string;
const sourceLines = (d: ContainerDetail): string[] => content(d).split('\n');
/** Content line holding the selection highlight (its first line, for an expanded value). */
const selectedLine = (d: ContainerDetail): number => sourceLines(d).findIndex((l) => l.includes('-bg}'));
const viewport = (d: ContainerDetail): number => Number(d.box.height) - Number(d.box.iheight);

describe('ContainerDetail env navigation and copy', () => {
  let screen: blessed.Widgets.Screen;
  let detail: ContainerDetail;
  let copies: string[];
  let infos: string[];
  let sections: Array<string | null>;

  beforeEach(() => {
    screen = makeScreen(100, 30);
    copies = [];
    infos = [];
    sections = [];
    detail = new ContainerDetail(screen, { top: 0, left: 0, width: '100%', height: '100%' }, async (text) => {
      copies.push(text);
      return { ok: true, method: 'native', tool: 'fake' };
    });
    detail.on('info', (m) => infos.push(m));
    detail.on('section', (id) => sections.push(id));
  });

  afterEach(() => {
    screen.destroy();
  });

  it('the copy menu owns the keyboard: screen keys stay silent until it closes', () => {
    const kill = vi.fn();
    screen.key(['k'], kill); // stands in for the tab's kill binding
    detail.show(container(['A=1', 'B=2']));

    press(screen, 'k');
    expect(kill).toHaveBeenCalledTimes(1);

    press(screen, 'y');
    expect(screen.grabKeys).toBe(true);
    press(screen, 'k');
    press(screen, 'h');
    expect(kill).toHaveBeenCalledTimes(1);

    press(screen, KEY.escape);
    expect(screen.grabKeys).toBe(false);
    expect(detail.isVisible()).toBe(true); // Esc closed the menu, not the panel

    press(screen, 'k');
    expect(kill).toHaveBeenCalledTimes(2);
  });

  it('copies the selected name, value, NAME=value, and all variables', async () => {
    detail.show(container(['TZ=UTC', LONG_PATH]));
    press(screen, 'e');
    press(screen, KEY.down);

    for (const key of ['n', 'v', 'y', 'a']) {
      press(screen, 'y');
      press(screen, key);
    }
    await settle();

    expect(copies).toEqual(['PATH', PATH_VALUE, LONG_PATH, `TZ=UTC\n${LONG_PATH}`]);
    expect(infos[0]).toBe('Copied name PATH');
    expect(infos[1]).toBe(`Copied value of PATH (${PATH_VALUE.length} chars)`);
    expect(infos).toHaveLength(4);
  });

  it('with no section selected, y copies the container itself', async () => {
    detail.show(container(['A=1', 'B=2']));
    for (const key of ['n', 'i', 'm', 'a']) {
      press(screen, 'y');
      press(screen, key);
    }
    await settle();
    expect(copies).toEqual(['db-pr02', 'b5322c040ce6aaaaaaaa', 'postgres:18', 'A=1\nB=2']);
    expect(infos[0]).toBe('Copied container name db-pr02');
  });

  it('with no variables, "all env" is offered but disabled', async () => {
    detail.show(container([]));
    press(screen, 'y');
    expect(screen.grabKeys).toBe(true);
    press(screen, 'a'); // disabled: ignored, menu stays open
    expect(screen.grabKeys).toBe(true);
    press(screen, KEY.escape);
    await settle();
    expect(copies).toEqual([]);
  });

  it('e puts the cursor on ENV and takes it away again, telling listeners', () => {
    detail.show(container(['A=1']));
    press(screen, 'e');
    expect(detail.focusedSection()).toBe('env');
    press(screen, 'e');
    expect(detail.focusedSection()).toBeNull();
    expect(sections).toEqual(['env', null]);
  });

  it('one Enter toggles a value once (blessed emits both enter and return)', () => {
    detail.show(container(['TZ=UTC', LONG_PATH]));
    press(screen, 'e');
    press(screen, KEY.down);
    const collapsed = sourceLines(detail).length;

    press(screen, KEY.enter);
    expect(sourceLines(detail).length).toBeGreaterThan(collapsed);
    expect(content(detail)).toContain('▾');

    press(screen, KEY.enter);
    expect(sourceLines(detail).length).toBe(collapsed);
  });

  it('→ / ← expand and collapse, E expands everything', () => {
    detail.show(container([LONG_PATH, 'MULTI=a\nb']));
    press(screen, 'e');
    const collapsed = sourceLines(detail).length;

    press(screen, KEY.right);
    const one = sourceLines(detail).length;
    expect(one).toBeGreaterThan(collapsed);
    press(screen, KEY.left);
    expect(sourceLines(detail).length).toBe(collapsed);

    press(screen, 'E');
    expect(sourceLines(detail).length).toBe(one + 1);
    press(screen, 'E');
    expect(sourceLines(detail).length).toBe(collapsed);
  });

  it('hide() with the menu open gives the keyboard back, and keys do nothing once hidden', () => {
    detail.show(container(['A=1']));
    press(screen, 'y');
    expect(screen.grabKeys).toBe(true);

    detail.hide(); // e.g. a poll found the container gone
    expect(screen.grabKeys).toBe(false);

    press(screen, 'e');
    press(screen, 'y');
    expect(sections).toEqual([]);
    expect(screen.grabKeys).toBe(false);
  });

  it('a poll that reorders the variables keeps the same one selected', async () => {
    detail.show(container(['A=1', 'B=2', 'C=3']));
    press(screen, 'e');
    press(screen, KEY.down);
    detail.update(container(['C=3', 'B=2', 'A=1']));

    press(screen, 'y');
    press(screen, 'n');
    await settle();
    expect(copies).toEqual(['B']);
  });

  it('pre-wraps env lines exactly as blessed lays them out, wide glyphs included', () => {
    const wide = `JP=${'東京'.repeat(120)}`;
    detail.show(container([LONG_PATH, wide, 'TAG={bold}x{/}']));
    press(screen, 'e');
    press(screen, 'E');
    const clines = (detail.box as any)._clines as unknown[];
    expect(clines.length).toBe(sourceLines(detail).length);
  });

  it('keeps the selection on screen even when lines above it wrap', () => {
    // MOUNTS rows are fitted to one line, but the summary's image line wraps: lines above ENV
    // that take more than one screen row each.
    const image = `registry.example.com/${'deep/'.repeat(60)}image:tag`;
    const env = Array.from({ length: 60 }, (_, i) => `VAR_${i}=value-${i}`);
    detail.show(container(env, { image }));
    press(screen, 'e');
    expect((detail.box as any)._clines.length).toBeGreaterThan(sourceLines(detail).length);

    const visible = () => {
      const ftor: number[][] = (detail.box as any)._clines.ftor;
      const row = ftor[selectedLine(detail)][0];
      const top = detail.box.childBase;
      return row >= top && row < top + viewport(detail);
    };

    for (let i = 0; i < 45; i++) press(screen, KEY.down);
    expect(visible()).toBe(true);
    press(screen, KEY.end);
    expect(visible()).toBe(true);
    press(screen, KEY.pageUp);
    expect(visible()).toBe(true);
    press(screen, KEY.home);
    expect(visible()).toBe(true);

    // Up past the first variable scrolls the panel back to the container summary.
    press(screen, KEY.up);
    expect(detail.box.childBase).toBe(0);
  });

  it('opens a new container scrolled to the top', () => {
    const env = Array.from({ length: 60 }, (_, i) => `VAR_${i}=v`);
    detail.show(container(env));
    press(screen, 'e');
    press(screen, KEY.end);
    expect(detail.box.childBase).toBeGreaterThan(0);

    detail.hide();
    detail.show(container(env));
    expect(detail.box.childBase).toBe(0);
  });
});

describe('ContainerDetail sections: Tab, MOUNTS and following links', () => {
  let screen: blessed.Widgets.Screen;
  let detail: ContainerDetail;
  let copies: string[];
  let sections: Array<string | null>;
  let gotos: unknown[];

  const volumeMount = {
    type: 'volume' as const,
    name: 'db-pr02_pgdata',
    source: '/var/lib/docker/volumes/db-pr02_pgdata/_data',
    destination: '/var/lib/postgresql',
    mode: 'rw',
    rw: true,
  };
  const bindMount = {
    type: 'bind' as const,
    source: '/host_mnt/private/tmp/db-pr02/sql',
    destination: '/sql',
    mode: 'rw',
    rw: true,
  };
  const withMounts = (env: string[] = ['A=1']) => container(env, { mounts: [bindMount, volumeMount] });

  beforeEach(() => {
    screen = makeScreen(100, 30);
    copies = [];
    sections = [];
    gotos = [];
    detail = new ContainerDetail(screen, { top: 0, left: 0, width: '100%', height: '100%' }, async (text) => {
      copies.push(text);
      return { ok: true, method: 'native', tool: 'fake' };
    });
    detail.on('section', (id) => sections.push(id));
    detail.on('goto', (ref) => gotos.push(ref));
  });

  afterEach(() => {
    screen.destroy();
  });

  it('Tab walks none → RELATED → MOUNTS → ENV → none, and Shift+Tab walks back', () => {
    detail.show(withMounts());
    for (let i = 0; i < 4; i++) press(screen, '\t');
    expect(sections).toEqual(['related', 'mounts', 'env', null]);
    press(screen, '\x1b[Z'); // Shift+Tab
    expect(detail.focusedSection()).toBe('env');
    press(screen, '\x1b[Z');
    expect(detail.focusedSection()).toBe('mounts');
  });

  it('Tab skips sections with nothing to select', () => {
    detail.show(container([], { mounts: [volumeMount] }));
    press(screen, '\t');
    press(screen, '\t');
    press(screen, '\t');
    expect(sections).toEqual(['related', 'mounts', null]);
  });

  it('NETWORKS: Tab reaches it after RELATED; ↵ opens the network, by name', () => {
    const networks = [
      endpoint('dzlink_back', { ip: '172.20.0.2', aliases: ['dzlink-db-1', 'db'] }),
      endpoint('dzlink_front'),
    ];
    detail.show(container(['A=1'], { networks, mounts: [volumeMount] }));
    expect(stripTags(content(detail))).toMatch(/dzlink_back\s+172\.20\.0\.2\s+dzlink-db-1, db/);
    expect(stripTags(content(detail))).toMatch(/dzlink_front\s+—/);
    press(screen, '\t');
    press(screen, '\t');
    expect(sections).toEqual(['related', 'networks']);
    press(screen, KEY.down);
    press(screen, KEY.enter);
    expect(gotos).toEqual([{ kind: 'network', id: 'dzlink_front' }]);
  });

  it('NETWORKS: copies the name, address, DNS names and every network', async () => {
    const networks = [
      endpoint('dzlink_back', { ip: '172.20.0.2', aliases: ['dzlink-db-1', 'db'] }),
      endpoint('dzlink_front'),
    ];
    detail.show(container(['A=1'], { networks }));
    press(screen, '\t');
    press(screen, '\t');
    for (const key of ['n', 'p', 'd', 'a']) {
      press(screen, 'y');
      press(screen, key);
    }
    await settle();
    expect(copies).toEqual(['dzlink_back', '172.20.0.2', 'dzlink-db-1\ndb', 'dzlink_back\ndzlink_front']);
  });

  it('DEPENDS ON: lists related containers after MOUNTS; ↵ follows one, once', () => {
    const db = { id: 'c-db', name: 'dzlink-db-1', status: 'running' as const, exitCode: 0 };
    detail.show(
      container(['A=1'], {
        mounts: [volumeMount],
        links: [
          { relation: 'depends-on', container: db, target: 'dzlink-db-1', service: 'db' },
          { relation: 'depends-on', target: 'cache', service: 'cache' },
        ],
      }),
    );
    expect(stripTags(content(detail))).toMatch(/depends on\s+● dzlink-db-1\s+\(compose depends_on: db\)/);
    expect(stripTags(content(detail))).toMatch(/depends on\s+cache\s+no container runs this service/);
    for (let i = 0; i < 3; i++) press(screen, '\t');
    expect(sections).toEqual(['related', 'mounts', 'links']);
    press(screen, KEY.enter);
    expect(gotos).toEqual([{ kind: 'container', id: 'c-db', label: 'dzlink-db-1' }]);
    press(screen, KEY.down);
    press(screen, KEY.enter); // unresolved: leads nowhere
    expect(gotos).toHaveLength(1);
  });

  it('PORTS: Tab reaches it after RELATED; copies the URL and -p specs, nothing to follow', async () => {
    const ports = [
      { ip: '127.0.0.1', publicPort: 18080, privatePort: 80, type: 'tcp' },
      { privatePort: 5432, type: 'tcp' },
    ];
    detail.show(container(['A=1'], { ports }));
    expect(stripTags(content(detail))).toMatch(
      /127\.0\.0\.1:18080\s+→ 80\/tcp\s+http:\/\/127\.0\.0\.1:18080/,
    );
    expect(stripTags(content(detail))).toMatch(/—\s+→ 5432\/tcp\s+not published/);
    press(screen, '\t');
    press(screen, '\t');
    expect(sections).toEqual(['related', 'ports']);
    press(screen, KEY.enter);
    expect(gotos).toEqual([]);
    for (const key of ['u', 'y', 'a']) {
      press(screen, 'y');
      press(screen, key);
    }
    press(screen, KEY.down);
    press(screen, 'y');
    press(screen, 'u'); // disabled: not published
    press(screen, KEY.escape);
    await settle();
    expect(copies).toEqual(['http://127.0.0.1:18080', '127.0.0.1:18080:80/tcp', '127.0.0.1:18080:80/tcp']);
  });

  it('RELATED: ↵ on the image opens the exact image it runs, once', () => {
    detail.show(withMounts());
    press(screen, '\t');
    press(screen, KEY.enter);
    expect(gotos).toEqual([{ kind: 'image', id: 'sha256:img', label: 'postgres:18' }]);
  });

  it('RELATED: says when a newer image carries its tag', () => {
    detail.show(withMounts());
    expect(stripTags(content(detail))).toMatch(/image\s+postgres:18\s*\n/);
    detail.update(container(['A=1'], { outdated: { tag: 'postgres:18', currentImageId: 'sha256:new' } }));
    expect(stripTags(content(detail))).toMatch(
      /image\s+postgres:18\s+newer image for postgres:18 available locally/,
    );
  });

  it('RELATED: copies the image name and ID', async () => {
    detail.show(withMounts());
    press(screen, '\t');
    for (const key of ['n', 'i']) {
      press(screen, 'y');
      press(screen, key);
    }
    await settle();
    expect(copies).toEqual(['postgres:18', 'sha256:img']);
  });

  it('ENV stays open when the cursor moves on; e then hides it', () => {
    detail.show(withMounts(['A=1']));
    press(screen, 'e');
    press(screen, '\t'); // → none
    expect(detail.focusedSection()).toBeNull();
    expect(stripTags(content(detail))).toContain('A=1');
    press(screen, 'e'); // ENV is open but not focused: e selects it
    expect(detail.focusedSection()).toBe('env');
    press(screen, 'e');
    expect(stripTags(content(detail))).not.toContain('A=1');
  });

  it('↵ on a bind does nothing; on a volume mount it follows, exactly once', () => {
    detail.show(withMounts());
    press(screen, '\t');
    press(screen, '\t'); // MOUNTS, on the bind (/sql)
    press(screen, KEY.enter);
    expect(gotos).toEqual([]);

    press(screen, KEY.down);
    press(screen, KEY.enter); // blessed sends `enter`, then `return`
    expect(gotos).toEqual([{ kind: 'volume', id: 'db-pr02_pgdata' }]);
  });

  it('copies a mount: volume name, source, destination, -v spec', async () => {
    detail.show(withMounts());
    press(screen, '\t');
    press(screen, '\t');
    press(screen, 'y');
    press(screen, 's'); // the bind's host path
    press(screen, KEY.down); // the volume
    for (const key of ['n', 's', 'd', 'y']) {
      press(screen, 'y');
      press(screen, key);
    }
    await settle();
    expect(copies).toEqual([
      '/private/tmp/db-pr02/sql',
      'db-pr02_pgdata',
      '/var/lib/docker/volumes/db-pr02_pgdata/_data',
      '/var/lib/postgresql',
      'db-pr02_pgdata:/var/lib/postgresql',
    ]);
  });

  it('gives its focus for history, and takes it back', () => {
    detail.show(withMounts());
    press(screen, '\t');
    press(screen, '\t');
    press(screen, KEY.down);
    const focus = detail.getFocus();
    expect(focus).toEqual({ section: 'mounts', row: '/var/lib/postgresql' });

    detail.hide();
    detail.show(withMounts());
    expect(detail.focusedSection()).toBeNull();
    detail.setFocus(focus);
    expect(detail.getFocus()).toEqual(focus);
  });
});
