import { spawn as nodeSpawn } from 'child_process';
import type { ChildProcess, SpawnOptions } from 'child_process';

export type ClipboardMethod = 'native' | 'tmux' | 'osc52';

export type ClipboardStrategy =
  | {
      kind: 'spawn';
      method: 'native' | 'tmux';
      cmd: string;
      args: string[];
      /** `clip.exe` only reads input as Unicode when it is UTF-16LE with a BOM. */
      encoding: 'utf8' | 'utf16le-bom';
      /** Merged over the inherited environment. */
      env?: Record<string, string>;
      /**
       * For tools that fork a process to keep owning the selection: in its own process group it
       * survives the terminal closing, so the clipboard isn't emptied when dockza's session ends.
       */
      detached?: boolean;
    }
  | { kind: 'osc52' };

export type CopyResult = { ok: true; method: ClipboardMethod; tool: string } | { ok: false; error: string };

export type SpawnFn = (cmd: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface ClipboardDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  spawn: SpawnFn;
  /** Writes raw bytes to the terminal; without it the OSC 52 fallback is unavailable. */
  writeTerminal?: (sequence: string) => void;
  /** Per tool. A tool that hangs (e.g. `termux-clipboard-set` without Termux:API) is killed. */
  timeoutMs: number;
}

interface StrategyContext {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
}

const msgOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Over SSH a local tool would fill the *remote* host's clipboard, which nobody is looking at. */
export function isRemoteSession(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.SSH_TTY || env.SSH_CONNECTION || env.SSH_CLIENT);
}

function nativeStrategies({ platform, env }: StrategyContext): ClipboardStrategy[] {
  const tool = (
    cmd: string,
    args: string[] = [],
    extra: Partial<Extract<ClipboardStrategy, { kind: 'spawn' }>> = {},
  ): ClipboardStrategy => ({ kind: 'spawn', method: 'native', cmd, args, encoding: 'utf8', ...extra });

  // pbcopy decodes stdin by locale; without a UTF-8 one non-ASCII text arrives mangled.
  if (platform === 'darwin') return [tool('pbcopy', [], { env: { LC_CTYPE: 'UTF-8' } })];
  if (platform === 'win32') return [tool('clip.exe', [], { encoding: 'utf16le-bom' })];

  const out: ClipboardStrategy[] = [];
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) out.push(tool('clip.exe', [], { encoding: 'utf16le-bom' }));
  if (env.TERMUX_VERSION || env.PREFIX?.includes('com.termux')) out.push(tool('termux-clipboard-set'));
  if (env.WAYLAND_DISPLAY) out.push(tool('wl-copy', [], { detached: true }));
  if (env.DISPLAY) {
    out.push(
      tool('xclip', ['-selection', 'clipboard', '-in'], { detached: true }),
      tool('xsel', ['--clipboard', '--input'], { detached: true }),
    );
  }
  return out;
}

/**
 * Ways to reach the user's clipboard, best first: the platform's own tool (local sessions only),
 * then tmux's buffer (≥ 3.2 forwards it to the outer terminal), then OSC 52 — an escape sequence
 * the terminal itself turns into a copy, which also works over SSH when the terminal allows it.
 */
export function clipboardStrategies(ctx: StrategyContext): ClipboardStrategy[] {
  const out = isRemoteSession(ctx.env) ? [] : nativeStrategies(ctx);
  if (ctx.env.TMUX) {
    out.push({
      kind: 'spawn',
      method: 'tmux',
      cmd: 'tmux',
      args: ['load-buffer', '-w', '-'],
      encoding: 'utf8',
    });
  }
  out.push({ kind: 'osc52' });
  return out;
}

/** `ESC ] 52 ; c ; <base64> BEL`, wrapped in tmux's DCS passthrough (inner ESC doubled) when in tmux. */
export function osc52Sequence(text: string, opts: { tmux?: boolean } = {}): string {
  const seq = `\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`;
  return opts.tmux ? `\x1bPtmux;\x1b${seq}\x1b\\` : seq;
}

export function encodeForTool(text: string, encoding: 'utf8' | 'utf16le-bom'): Buffer {
  if (encoding === 'utf16le-bom')
    return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  return Buffer.from(text, 'utf8');
}

/** Resolves `null` on success, otherwise a short reason. Never rejects. */
function runTool(
  s: Extract<ClipboardStrategy, { kind: 'spawn' }>,
  text: string,
  deps: ClipboardDeps,
): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = deps.spawn(s.cmd, s.args, {
        // xclip / wl-copy leave a child behind that would hold stdout open forever: don't pipe it.
        stdio: ['pipe', 'ignore', 'ignore'],
        windowsHide: true,
        detached: s.detached ?? false,
        env: s.env ? { ...deps.env, ...s.env } : undefined,
      });
    } catch (err) {
      resolve(`${s.cmd}: ${msgOf(err)}`);
      return;
    }

    let settled = false;
    const finish = (reason: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(reason);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(`${s.cmd} timed out`);
    }, deps.timeoutMs);

    child.on('error', (err) => finish(`${s.cmd}: ${err.message}`));
    child.on('exit', (code) => finish(code === 0 ? null : `${s.cmd} exited with code ${code}`));
    // EPIPE when the tool dies before reading; its exit code already reports the failure.
    child.stdin?.on('error', () => {});
    child.stdin?.end(encodeForTool(text, s.encoding));
  });
}

/** Copies `text`, trying each strategy in turn. Reports failure in the result instead of throwing. */
export async function copyToClipboard(text: string, deps: Partial<ClipboardDeps> = {}): Promise<CopyResult> {
  const d: ClipboardDeps = {
    platform: process.platform,
    env: process.env,
    spawn: nodeSpawn,
    timeoutMs: 2000,
    ...deps,
  };

  const failures: string[] = [];
  for (const s of clipboardStrategies(d)) {
    if (s.kind === 'osc52') {
      if (!d.writeTerminal) {
        failures.push('no terminal to send OSC 52 to');
        continue;
      }
      try {
        d.writeTerminal(osc52Sequence(text, { tmux: Boolean(d.env.TMUX) }));
        return { ok: true, method: 'osc52', tool: 'OSC 52' };
      } catch (err) {
        failures.push(`OSC 52: ${msgOf(err)}`);
        continue;
      }
    }
    const reason = await runTool(s, text, d);
    if (reason === null) return { ok: true, method: s.method, tool: s.cmd };
    failures.push(reason);
  }
  return { ok: false, error: failures.join('; ') };
}

/** Footer line for a finished copy. `subject` names what was copied, e.g. `value of PATH (48 chars)`. */
export function describeCopy(subject: string, result: CopyResult): { text: string; color: 'green' | 'red' } {
  if (!result.ok) return { text: `Copy failed: ${result.error}`, color: 'red' };
  if (result.method === 'osc52') return { text: `Copied ${subject} via terminal (OSC 52)`, color: 'green' };
  if (result.method === 'tmux') return { text: `Copied ${subject} to the tmux buffer`, color: 'green' };
  return { text: `Copied ${subject}`, color: 'green' };
}
