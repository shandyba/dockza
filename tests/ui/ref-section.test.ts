import { describe, it, expect } from 'vitest';
import type { MountInfo } from '@models/docker';
import { stripTags } from '@utils/format';
import { MOUNT_ROWS } from '@ui/containers/mount-rows';
import { RefSection } from '@ui/detail/ref-section';

const COLS = 70;

/** What the terminal shows: tags stripped, escaped braces restored. */
function plain(line: string): string {
  return stripTags(line.replace(/\{open\}/g, '').replace(/\{close\}/g, ''))
    .replace(//g, '{')
    .replace(//g, '}');
}

const volume: MountInfo = {
  type: 'volume',
  name: 'db-pr02_pgdata',
  source: '/var/lib/docker/volumes/db-pr02_pgdata/_data',
  destination: '/var/lib/postgresql',
  mode: 'rw',
  rw: true,
};
const bind: MountInfo = {
  type: 'bind',
  source: '/host_mnt/private/tmp/db-pr02/sql',
  destination: '/sql',
  mode: 'ro',
  rw: false,
};
const tmpfs: MountInfo = { type: 'tmpfs', source: '', destination: '/run', mode: '', rw: true };

function section(rows: MountInfo[]): RefSection<MountInfo> {
  const s = new RefSection(MOUNT_ROWS);
  s.reset(rows);
  return s;
}

describe('RefSection rendering', () => {
  it('lists rows under a counted title, aligned in columns', () => {
    const r = section([volume, bind]).render(COLS, false);
    const lines = r.lines.map(plain);
    expect(lines[0]).toBe('MOUNTS (2)  Tab select');
    expect(lines[1]).toBe('   volume  db-pr02_pgdata            → /var/lib/postgresql  rw');
    expect(lines[2]).toBe('   bind    /private/tmp/db-pr02/sql  → /sql                 ro');
    expect(r.activeRange).toBeNull();
  });

  it('with the cursor: highlights the row, spans the section, and hints the keys', () => {
    const s = section([volume, bind]);
    const r = s.render(COLS, true);
    expect(plain(r.lines[0])).toBe('MOUNTS (2)  ↑↓ select · ↵ open volume · y copy · Tab next');
    expect(r.lines[1]).toContain('-bg}');
    expect(plain(r.lines[1])).toHaveLength(COLS);
    expect(r.lines[2]).not.toContain('-bg}');
    // The first row's range starts at the title, so revealing it shows the title too.
    expect(r.activeRange).toEqual([0, 1]);
    s.move(1);
    expect(s.render(COLS, true).activeRange).toEqual([2, 2]);
  });

  it('leaves the ↵ hint out when no row leads anywhere', () => {
    expect(plain(section([bind, tmpfs]).render(COLS, true).lines[0])).not.toContain('↵');
  });

  it("gives the footer its hints, ↵ named by the spec's verb only where a row leads somewhere", () => {
    const verbs = (s: RefSection<MountInfo>) => s.footerHints().map((h) => `${h.key} ${h.verb}`);
    expect(verbs(section([bind, volume]))).toEqual([
      '↑↓ select',
      '↵ open volume',
      'y copy',
      'Tab next',
      'Esc close',
      '[ ] back/fwd',
    ]);
    expect(verbs(section([bind]))).not.toContain('↵ open volume');
  });

  it('styles a followable name as a link, and a bind source as plain text', () => {
    const [, vol, bnd] = section([volume, bind]).render(COLS, false).lines;
    expect(vol).toContain('{underline}');
    expect(bnd).not.toContain('{underline}');
  });

  it('says so when there are no rows', () => {
    expect(section([]).render(COLS, true).lines.map(plain)).toEqual(['MOUNTS (0)  none']);
  });

  it('cuts long cells to fit, paths in the middle', () => {
    const deep: MountInfo = {
      ...bind,
      source: `/home/me/${'nested/'.repeat(20)}project`,
      destination: '/src',
    };
    const lines = section([deep, volume]).render(50, false).lines.map(plain);
    for (const l of lines.slice(1)) expect(l.length).toBeLessThanOrEqual(50);
    expect(lines[1]).toMatch(/\/home\/me\/.*….*project/);
  });

  it('escapes markup in names and paths', () => {
    const tagged: MountInfo = { ...bind, source: '/srv/{bold}x{/bold}' };
    const [, line] = section([tagged]).render(COLS, false).lines;
    expect(line).not.toContain('{bold}');
    expect(plain(line)).toContain('/srv/{bold}x{/bold}');
  });
});

describe('RefSection selection and keys', () => {
  it('↵ follows a volume mount; a bind leads nowhere; the `return` echo is ignored', () => {
    const s = section([volume, bind]);
    expect(s.onKey('enter')).toEqual({ goto: { kind: 'volume', id: 'db-pr02_pgdata' } });
    expect(s.onKey('return')).toBe('ignored');
    s.move(1);
    expect(s.onKey('enter')).toBe('ignored');
  });

  it('a poll that reorders the rows keeps the same one selected', () => {
    const s = section([volume, bind, tmpfs]);
    s.move(1);
    s.setRows([tmpfs, bind, volume]);
    expect(s.selected()).toBe(bind);
    s.setRows([tmpfs]);
    expect(s.selected()).toBe(tmpfs);
  });

  it('keys rows for history, and selects them back', () => {
    const s = section([volume, bind]);
    s.last();
    expect(s.rowKey()).toBe('/sql');
    expect(s.selectRow('/var/lib/postgresql')).toBe(true);
    expect(s.atFirst()).toBe(true);
    expect(s.selectRow('/nope')).toBe(false);
  });
});

describe('MOUNTS copy options', () => {
  const byKey = (s: RefSection<MountInfo>) => Object.fromEntries(s.copyOptions().map((o) => [o.key, o]));

  it('a volume mount: its name, source, destination, -v spec, and all specs', () => {
    const o = byKey(section([volume, bind, tmpfs]));
    expect(o.n.text).toBe('db-pr02_pgdata');
    expect(o.s.text).toBe('/var/lib/docker/volumes/db-pr02_pgdata/_data');
    expect(o.d.text).toBe('/var/lib/postgresql');
    expect(o.y.text).toBe('db-pr02_pgdata:/var/lib/postgresql');
    expect(o.a.text).toBe('db-pr02_pgdata:/var/lib/postgresql\n/private/tmp/db-pr02/sql:/sql:ro');
    expect(o.a.label).toBe('all (2)');
    expect(o.n.subject).toBe('volume name db-pr02_pgdata');
  });

  it('a bind: no volume name, and the host path without /host_mnt', () => {
    const s = section([bind]);
    const o = byKey(s);
    expect(o.n.text).toBeNull();
    expect(o.n.reason).toBe('bind mount — no volume');
    expect(o.s.label).toBe('host path');
    expect(o.s.text).toBe('/private/tmp/db-pr02/sql');
  });

  it('tmpfs: nothing -v can express', () => {
    const o = byKey(section([tmpfs]));
    expect(o.y.text).toBeNull();
    expect(o.s.text).toBeNull();
    expect(o.a.text).toBeNull();
    expect(o.d.text).toBe('/run');
  });
});
