import blessed from 'neo-blessed';
import { C, t } from '@theme';
import { escapeTags, visualLength } from '@utils/format';

export type FooterContext =
  | 'global'
  | 'stacks-tree-stack'
  | 'stacks-tree-running'
  | 'stacks-tree-stopped'
  | 'containers-running'
  | 'containers-stopped'
  | 'containers-empty'
  | 'images'
  | 'volumes'
  | 'networks'
  | 'detail'
  | 'volume-detail'
  | 'image-detail'
  | 'network-detail'
  | 'stack-detail'
  | 'log'
  | 'filter';

export interface FooterMessage {
  text: string;
  color: 'red' | 'green' | 'normal';
}

/** One key and what it does, as the footer shows it. */
export interface Hint {
  key: string;
  verb: string;
}

export const BACK: Hint = { key: '[ ]', verb: 'back/fwd' };

const FILTER: Hint = { key: '/', verb: 'filter' };
const UNFILTER: Hint = { key: 'Esc', verb: 'unfilter' };

/** Over a detail panel with no section selected. */
const RESOURCE_DETAIL: Hint[] = [
  { key: 'Tab', verb: 'section' },
  { key: 'y', verb: 'copy' },
  { key: 'd', verb: 'delete' },
  { key: '↑↓', verb: 'scroll' },
  { key: 'Esc', verb: 'close' },
  BACK,
];

const HINTS: Record<FooterContext, Hint[]> = {
  global: [
    { key: '↑↓', verb: 'nav' },
    { key: '↵', verb: 'select' },
    { key: '1-5', verb: 'view' },
    FILTER,
    BACK,
    { key: 'h', verb: 'help' },
    { key: 'q', verb: 'quit' },
  ],
  'stacks-tree-stack': [
    { key: '↑↓', verb: 'nav' },
    { key: '↵', verb: 'detail' },
    { key: '→←', verb: 'expand' },
    FILTER,
    BACK,
    { key: 'h', verb: 'help' },
    { key: 'q', verb: 'quit' },
  ],
  'stacks-tree-running': [
    { key: '↑↓', verb: 'nav' },
    { key: '↵', verb: 'detail' },
    { key: 'l', verb: 'logs' },
    { key: 'x', verb: 'shell' },
    { key: 's', verb: 'stop' },
    { key: 'r', verb: 'restart' },
    { key: 'k', verb: 'kill' },
    FILTER,
    BACK,
    { key: 'h', verb: 'help' },
  ],
  'stacks-tree-stopped': [
    { key: '↑↓', verb: 'nav' },
    { key: '↵', verb: 'detail' },
    { key: 'l', verb: 'logs' },
    { key: 'S', verb: 'start' },
    { key: 'd', verb: 'remove' },
    FILTER,
    BACK,
    { key: 'h', verb: 'help' },
  ],
  'containers-running': [
    { key: '↑↓', verb: 'nav' },
    { key: '↵', verb: 'detail' },
    { key: 'l', verb: 'logs' },
    { key: 'x', verb: 'shell' },
    { key: 's', verb: 'stop' },
    { key: 'r', verb: 'restart' },
    { key: 'k', verb: 'kill' },
    FILTER,
    BACK,
    { key: 'h', verb: 'help' },
  ],
  'containers-stopped': [
    { key: '↑↓', verb: 'nav' },
    { key: '↵', verb: 'detail' },
    { key: 'l', verb: 'logs' },
    { key: 'S', verb: 'start' },
    { key: 'd', verb: 'remove' },
    FILTER,
    BACK,
    { key: 'h', verb: 'help' },
  ],
  'containers-empty': [
    { key: '↑↓', verb: 'nav' },
    { key: '1-5', verb: 'view' },
    FILTER,
    BACK,
    { key: 'h', verb: 'help' },
    { key: 'q', verb: 'quit' },
  ],
  images: [
    { key: '↑↓', verb: 'nav' },
    { key: '↵', verb: 'detail' },
    { key: 'd', verb: 'delete' },
    FILTER,
    BACK,
    { key: 'h', verb: 'help' },
    { key: 'q', verb: 'quit' },
  ],
  volumes: [
    { key: '↑↓', verb: 'nav' },
    { key: '↵', verb: 'detail' },
    { key: 'd', verb: 'delete' },
    FILTER,
    BACK,
    { key: 'h', verb: 'help' },
    { key: 'q', verb: 'quit' },
  ],
  networks: [
    { key: '↑↓', verb: 'nav' },
    { key: '↵', verb: 'detail' },
    { key: 'd', verb: 'delete' },
    FILTER,
    BACK,
    { key: 'h', verb: 'help' },
    { key: 'q', verb: 'quit' },
  ],
  detail: [
    { key: 'Tab', verb: 'section' },
    { key: 'e', verb: 'env' },
    { key: 'y', verb: 'copy' },
    { key: 'l', verb: 'logs' },
    { key: 's/r/k', verb: 'ctrl' },
    { key: '↑↓', verb: 'scroll' },
    { key: 'Esc', verb: 'close' },
    BACK,
  ],
  'volume-detail': RESOURCE_DETAIL,
  'image-detail': RESOURCE_DETAIL,
  'network-detail': RESOURCE_DETAIL,
  'stack-detail': [
    { key: 'Tab', verb: 'section' },
    { key: 'y', verb: 'copy' },
    { key: '↑↓', verb: 'scroll' },
    { key: 'Esc', verb: 'close' },
    BACK,
  ],
  log: [
    { key: '↵', verb: 'detail' },
    { key: 'f', verb: 'follow' },
    { key: 'g', verb: 'top' },
    { key: 'G', verb: 'bottom' },
    { key: '↑↓', verb: 'scroll' },
    { key: 'Esc', verb: 'close' },
    BACK,
  ],
  filter: [
    { key: '↑↓', verb: 'nav' },
    { key: '↵', verb: 'done' },
    { key: 'Esc', verb: 'clear' },
    { key: '^U', verb: 'erase' },
  ],
};

/** A list's hints while its filter hides rows: Esc, right after `/`, clears it. */
export function filteredHints(context: FooterContext): Hint[] {
  const hints = HINTS[context].filter((h) => h !== FILTER);
  const at = HINTS[context].indexOf(FILTER);
  const back = hints.indexOf(BACK);
  const pos = at >= 0 ? at : back >= 0 ? back : hints.length;
  return [...hints.slice(0, pos), FILTER, UNFILTER, ...hints.slice(pos)];
}

/**
 * What the footer shows: a named context, or — while a panel section has the cursor — that
 * section's own hints (`PanelSection.footerHints`), which differ only in what ↵ does.
 */
export type FooterHints = FooterContext | Hint[];

export class Footer {
  readonly box: blessed.Widgets.BoxElement;

  private hints: Hint[] = HINTS.global;
  private message: FooterMessage | null = null;
  private lastRefreshAt: number | null = null;
  private tickerHandle: NodeJS.Timeout | null = null;

  constructor(screen: blessed.Widgets.Screen) {
    this.box = blessed.box({
      parent: screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      tags: true,
      style: { bg: C.bg, fg: C.fg },
    });
  }

  setContext(c: FooterHints): void {
    this.hints = typeof c === 'string' ? HINTS[c] : c;
    this.render();
  }

  setMessage(message: FooterMessage | null): void {
    this.message = message;
    this.render();
  }

  noteRefresh(): void {
    this.lastRefreshAt = Date.now();
    this.render();
  }

  startTicker(onTick: () => void): void {
    if (this.tickerHandle) return;
    this.tickerHandle = setInterval(() => {
      this.render();
      onTick();
    }, 1000);
  }

  stopTicker(): void {
    if (this.tickerHandle) {
      clearInterval(this.tickerHandle);
      this.tickerHandle = null;
    }
  }

  render(): void {
    const width = Number(this.box.width) || 80;
    const right = this.buildRight();
    const left = this.message ? this.buildMessage() : this.buildHints(width - visualLength(right) - 2);
    const gap = Math.max(1, width - visualLength(left) - visualLength(right));
    this.box.setContent(left + ' '.repeat(gap) + right);
  }

  private buildMessage(): string {
    if (!this.message) return '';
    // Messages are plain text that can quote anything (a var name, a docker error): never markup.
    const text = escapeTags(this.message.text);
    if (this.message.color === 'red') return ` ${t.red(text)}`;
    if (this.message.color === 'green') return ` ${t.green(text)}`;
    return ` ${t.fg(text)}`;
  }

  private buildHints(budget: number): string {
    const hints = this.hints;
    const parts: string[] = [' '];
    let visible = 1;
    for (const h of hints) {
      const piece = `${this.renderKey(h.key)} ${t.dim(h.verb)}`;
      const pieceLen = visualLength(piece);
      const separator = parts.length === 1 ? '' : '  ';
      const sepLen = separator.length;
      if (visible + pieceLen + sepLen > budget) {
        if (parts.length > 1) parts.push(t.faint('…'));
        break;
      }
      parts.push(separator + piece);
      visible += pieceLen + sepLen;
    }
    return parts.join('');
  }

  private renderKey(key: string): string {
    return `{${C.rule2}-bg}{${C.fg}-fg} ${key} {/}`;
  }

  private buildRight(): string {
    if (!this.lastRefreshAt) return `${t.faint('—')} `;
    const ageSec = (Date.now() - this.lastRefreshAt) / 1000;
    const label = ageSec < 1 ? `${ageSec.toFixed(1)}s` : `${Math.floor(ageSec)}s`;
    return `${t.faint(`last refresh ${label} ago`)} `;
  }
}
