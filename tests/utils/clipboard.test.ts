import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { Writable } from 'stream';
import type { SpawnOptions } from 'child_process';
import {
  clipboardStrategies,
  copyToClipboard,
  describeCopy,
  encodeForTool,
  isRemoteSession,
  osc52Sequence,
  type ClipboardStrategy,
  type SpawnFn,
} from '@utils/clipboard';

const names = (list: ClipboardStrategy[]): string[] =>
  list.map((s) => (s.kind === 'osc52' ? 'osc52' : s.cmd));

describe('clipboardStrategies', () => {
  const pick = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}) =>
    names(clipboardStrategies({ platform, env }));

  it('macOS: pbcopy with a UTF-8 locale, then OSC 52', () => {
    const list = clipboardStrategies({ platform: 'darwin', env: {} });
    expect(names(list)).toEqual(['pbcopy', 'osc52']);
    expect(list[0]).toMatchObject({ env: { LC_CTYPE: 'UTF-8' }, encoding: 'utf8' });
  });

  it('Windows: clip.exe fed UTF-16LE with a BOM', () => {
    const list = clipboardStrategies({ platform: 'win32', env: {} });
    expect(names(list)).toEqual(['clip.exe', 'osc52']);
    expect(list[0]).toMatchObject({ encoding: 'utf16le-bom' });
  });

  it('Linux without a display server: OSC 52 only', () => {
    expect(pick('linux')).toEqual(['osc52']);
  });

  it('Linux Wayland: wl-copy, detached', () => {
    const list = clipboardStrategies({ platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' } });
    expect(names(list)).toEqual(['wl-copy', 'osc52']);
    expect(list[0]).toMatchObject({ detached: true });
  });

  it('Linux X11: xclip then xsel, both detached', () => {
    const list = clipboardStrategies({ platform: 'linux', env: { DISPLAY: ':0' } });
    expect(names(list)).toEqual(['xclip', 'xsel', 'osc52']);
    expect(list.slice(0, 2).every((s) => s.kind === 'spawn' && s.detached)).toBe(true);
  });

  it('XWayland: Wayland first, X11 tools as fallback', () => {
    expect(pick('linux', { WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' })).toEqual([
      'wl-copy',
      'xclip',
      'xsel',
      'osc52',
    ]);
  });

  it('WSL: the Windows clipboard first', () => {
    expect(pick('linux', { WSL_DISTRO_NAME: 'Ubuntu', DISPLAY: ':0' })).toEqual([
      'clip.exe',
      'xclip',
      'xsel',
      'osc52',
    ]);
    expect(pick('linux', { WSL_INTEROP: '/run/WSL/1_interop' })[0]).toBe('clip.exe');
  });

  it('Termux: termux-clipboard-set', () => {
    expect(pick('android', { TERMUX_VERSION: '0.118' })).toEqual(['termux-clipboard-set', 'osc52']);
    expect(pick('linux', { PREFIX: '/data/data/com.termux/files/usr' })[0]).toBe('termux-clipboard-set');
  });

  it('over SSH: skips local tools, which would fill the remote clipboard', () => {
    expect(pick('darwin', { SSH_TTY: '/dev/ttys001' })).toEqual(['osc52']);
    expect(pick('linux', { SSH_CONNECTION: '1 2 3 4', DISPLAY: 'localhost:10.0' })).toEqual(['osc52']);
  });

  it('inside tmux: native tool, then the tmux buffer, then OSC 52', () => {
    expect(pick('darwin', { TMUX: '/tmp/tmux-501/default,1,0' })).toEqual(['pbcopy', 'tmux', 'osc52']);
  });

  it('tmux over SSH: tmux buffer, then OSC 52', () => {
    const list = clipboardStrategies({ platform: 'linux', env: { TMUX: 'x', SSH_CLIENT: 'y' } });
    expect(names(list)).toEqual(['tmux', 'osc52']);
    expect(list[0]).toMatchObject({ method: 'tmux', args: ['load-buffer', '-w', '-'] });
  });
});

describe('isRemoteSession', () => {
  it('detects any of the SSH variables', () => {
    expect(isRemoteSession({})).toBe(false);
    expect(isRemoteSession({ SSH_TTY: '/dev/pts/0' })).toBe(true);
    expect(isRemoteSession({ SSH_CONNECTION: 'a' })).toBe(true);
    expect(isRemoteSession({ SSH_CLIENT: 'a' })).toBe(true);
  });
});

describe('osc52Sequence', () => {
  it('base64-encodes UTF-8 into an OSC 52 clipboard write', () => {
    const b64 = Buffer.from('héllo 🚀', 'utf8').toString('base64');
    expect(osc52Sequence('héllo 🚀')).toBe(`\x1b]52;c;${b64}\x07`);
  });

  it('wraps in tmux DCS passthrough with the inner ESC doubled', () => {
    const b64 = Buffer.from('x').toString('base64');
    expect(osc52Sequence('x', { tmux: true })).toBe(`\x1bPtmux;\x1b\x1b]52;c;${b64}\x07\x1b\\`);
  });
});

describe('encodeForTool', () => {
  it('prefixes UTF-16LE with a BOM for clip.exe', () => {
    const buf = encodeForTool('Kä', 'utf16le-bom');
    expect([...buf]).toEqual([0xff, 0xfe, 0x4b, 0x00, 0xe4, 0x00]);
  });

  it('sends UTF-8 otherwise', () => {
    expect(encodeForTool('ä', 'utf8')).toEqual(Buffer.from('ä', 'utf8'));
  });
});

type Behavior = 'ok' | 'exit1' | 'enoent' | 'hang' | 'throw';

interface SpawnCall {
  cmd: string;
  args: string[];
  options: SpawnOptions;
  input: () => Buffer;
  kill: ReturnType<typeof vi.fn>;
}

/** Stands in for child_process.spawn: each command behaves as scripted (default: not installed). */
function fakeSpawn(behaviors: Record<string, Behavior>): { spawn: SpawnFn; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawn: SpawnFn = (cmd, args, options) => {
    const behavior = behaviors[cmd] ?? 'enoent';
    if (behavior === 'throw') throw new Error('spawn EINVAL');

    const child: any = new EventEmitter();
    const chunks: Buffer[] = [];
    child.stdin = new Writable({
      write(chunk: Buffer, _enc, cb) {
        chunks.push(chunk);
        cb();
      },
    });
    child.kill = vi.fn(() => true);
    calls.push({ cmd, args, options, input: () => Buffer.concat(chunks), kill: child.kill });

    child.stdin.on('finish', () => {
      if (behavior === 'ok') child.emit('exit', 0);
      if (behavior === 'exit1') child.emit('exit', 1);
    });
    if (behavior === 'enoent') {
      setImmediate(() => child.emit('error', new Error(`spawn ${cmd} ENOENT`)));
    }
    return child;
  };
  return { spawn, calls };
}

describe('copyToClipboard', () => {
  it('uses the native tool and pipes the text as UTF-8', async () => {
    const { spawn, calls } = fakeSpawn({ pbcopy: 'ok' });
    const result = await copyToClipboard('Київ', { platform: 'darwin', env: { HOME: '/h' }, spawn });

    expect(result).toEqual({ ok: true, method: 'native', tool: 'pbcopy' });
    expect(calls).toHaveLength(1);
    expect(calls[0].input().toString('utf8')).toBe('Київ');
    expect(calls[0].options).toMatchObject({ stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
    // The locale is merged over the inherited environment, not substituted for it.
    expect(calls[0].options.env).toEqual({ HOME: '/h', LC_CTYPE: 'UTF-8' });
  });

  it('feeds clip.exe UTF-16LE with a BOM', async () => {
    const { spawn, calls } = fakeSpawn({ 'clip.exe': 'ok' });
    await copyToClipboard('é', { platform: 'win32', env: {}, spawn });
    expect([...calls[0].input()]).toEqual([0xff, 0xfe, 0xe9, 0x00]);
  });

  it('falls through a missing tool to the next one', async () => {
    const { spawn, calls } = fakeSpawn({ xsel: 'ok' });
    const result = await copyToClipboard('x', { platform: 'linux', env: { DISPLAY: ':0' }, spawn });

    expect(result).toEqual({ ok: true, method: 'native', tool: 'xsel' });
    expect(calls.map((c) => c.cmd)).toEqual(['xclip', 'xsel']);
    expect(calls[1].options.detached).toBe(true);
  });

  it('falls through a non-zero exit and a spawn that throws', async () => {
    const { spawn, calls } = fakeSpawn({ 'wl-copy': 'exit1', xclip: 'throw', xsel: 'ok' });
    const env = { WAYLAND_DISPLAY: 'w', DISPLAY: ':0' };
    const result = await copyToClipboard('x', { platform: 'linux', env, spawn });

    expect(result).toMatchObject({ ok: true, tool: 'xsel' });
    expect(calls.map((c) => c.cmd)).toEqual(['wl-copy', 'xsel']);
  });

  it('kills a tool that hangs and moves on', async () => {
    const { spawn, calls } = fakeSpawn({ 'termux-clipboard-set': 'hang' });
    const writeTerminal = vi.fn();
    const result = await copyToClipboard('x', {
      platform: 'android',
      env: { TERMUX_VERSION: '1' },
      spawn,
      writeTerminal,
      timeoutMs: 10,
    });

    expect(calls[0].kill).toHaveBeenCalled();
    expect(result).toEqual({ ok: true, method: 'osc52', tool: 'OSC 52' });
  });

  it('falls back to OSC 52 when no native tool works', async () => {
    const { spawn } = fakeSpawn({});
    const writeTerminal = vi.fn();
    const result = await copyToClipboard('hi', {
      platform: 'linux',
      env: { DISPLAY: ':0' },
      spawn,
      writeTerminal,
    });

    expect(result).toEqual({ ok: true, method: 'osc52', tool: 'OSC 52' });
    expect(writeTerminal).toHaveBeenCalledWith(osc52Sequence('hi'));
  });

  it('wraps the OSC 52 fallback for tmux', async () => {
    const { spawn } = fakeSpawn({ tmux: 'exit1' });
    const writeTerminal = vi.fn();
    await copyToClipboard('hi', { platform: 'linux', env: { TMUX: 't' }, spawn, writeTerminal });
    expect(writeTerminal).toHaveBeenCalledWith(osc52Sequence('hi', { tmux: true }));
  });

  it('reports the tmux buffer when tmux takes it', async () => {
    const { spawn } = fakeSpawn({ tmux: 'ok' });
    const result = await copyToClipboard('hi', {
      platform: 'linux',
      env: { TMUX: 't', SSH_TTY: 's' },
      spawn,
    });
    expect(result).toEqual({ ok: true, method: 'tmux', tool: 'tmux' });
  });

  it('fails with every reason when nothing works and there is no terminal to write to', async () => {
    const { spawn } = fakeSpawn({});
    const result = await copyToClipboard('x', { platform: 'darwin', env: {}, spawn });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('pbcopy: spawn pbcopy ENOENT');
      expect(result.error).toContain('no terminal to send OSC 52 to');
    }
  });

  it('fails when writing the OSC 52 sequence throws', async () => {
    const { spawn } = fakeSpawn({});
    const writeTerminal = () => {
      throw new Error('EPIPE');
    };
    const result = await copyToClipboard('x', { platform: 'linux', env: {}, spawn, writeTerminal });
    expect(result).toEqual({ ok: false, error: 'OSC 52: EPIPE' });
  });
});

describe('describeCopy', () => {
  it('names the subject and how it was copied', () => {
    expect(describeCopy('name PATH', { ok: true, method: 'native', tool: 'pbcopy' })).toEqual({
      text: 'Copied name PATH',
      color: 'green',
    });
    expect(describeCopy('x', { ok: true, method: 'osc52', tool: 'OSC 52' }).text).toBe(
      'Copied x via terminal (OSC 52)',
    );
    expect(describeCopy('x', { ok: true, method: 'tmux', tool: 'tmux' }).text).toBe(
      'Copied x to the tmux buffer',
    );
  });

  it('reports failures in red', () => {
    expect(describeCopy('x', { ok: false, error: 'boom' })).toEqual({
      text: 'Copy failed: boom',
      color: 'red',
    });
  });
});
