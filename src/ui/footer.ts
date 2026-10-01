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
  | 'detail-env'
  | 'detail-mounts'
  | 'volume-detail'
  | 'volume-detail-users'
  | 'log';

export interface FooterMessage {
  text: string;
  color: 'red' | 'green' | 'normal';
}

interface Hint {
  key: string;
  verb: string;
}

const BACK: Hint = { key: '[ ]', verb: 'back/fwd' };

const HINTS: Record<FooterContext, Hint[]> = {
  global: [
    { key: '↑↓', verb: 'nav' },
    { key: '↵', verb: 'select' },
    { key: '1-5', verb: 'view' },
    BACK,
    { key: 'h', verb: 'help' },
    { key: 'q', verb: 'quit' },
  ],
  'stacks-tree-stack': [
    { key: '↑↓', verb: 'nav' },
    { key: '→←', verb: 'expand' },
    { key: '↵', verb: 'toggle' },
    { key: '/', verb: 'filter' },
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
    { key: '/', verb: 'filter' },
    BACK,
    { key: 'h', verb: 'help' },
  ],
  'stacks-tree-stopped': [
    { key: '↑↓', verb: 'nav' },
    { key: '↵', verb: 'detail' },
    { key: 'l', verb: 'logs' },
    { key: 'S', verb: 'start' },
    { key: 'd', verb: 'remove' },
    { key: '/', verb: 'filter' },
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
    BACK,
    { key: 'h', verb: 'help' },
  ],
  'containers-stopped': [
    { key: '↑↓', verb: 'nav' },
    { key: '↵', verb: 'detail' },
    { key: 'l', verb: 'logs' },
    { key: 'S', verb: 'start' },
    { key: 'd', verb: 'remove' },
    BACK,
    { key: 'h', verb: 'help' },
  ],
  'containers-empty': [
    { key: '↑↓', verb: 'nav' },
    { key: '1-5', verb: 'view' },
    BACK,
    { key: 'h', verb: 'help' },
    { key: 'q', verb: 'quit' },
  ],
  images: [
    { key: '↑↓', verb: 'nav' },
    { key: 'd', verb: 'delete' },
    BACK,
    { key: 'h', verb: 'help' },
    { key: 'q', verb: 'quit' },
  ],
  volumes: [
    { key: '↑↓', verb: 'nav' },
    { key: '↵', verb: 'detail' },
    { key: 'd', verb: 'delete' },
    BACK,
    { key: 'h', verb: 'help' },
    { key: 'q', verb: 'quit' },
  ],
  networks: [
    { key: '↑↓', verb: 'nav' },
    { key: 'd', verb: 'delete' },
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
  'detail-env': [
    { key: '↑↓', verb: 'select' },
    { key: '↵', verb: 'value' },
    { key: 'E', verb: 'all' },
    { key: 'y', verb: 'copy' },
    { key: 'Tab', verb: 'next' },
    { key: 'e', verb: 'hide' },
    { key: 'Esc', verb: 'close' },
  ],
  'detail-mounts': [
    { key: '↑↓', verb: 'select' },
    { key: '↵', verb: 'open volume' },
    { key: 'y', verb: 'copy' },
    { key: 'Tab', verb: 'next' },
    { key: 'Esc', verb: 'close' },
    BACK,
  ],
  'volume-detail': [
    { key: 'Tab', verb: 'section' },
    { key: 'y', verb: 'copy' },
    { key: 'd', verb: 'delete' },
    { key: '↑↓', verb: 'scroll' },
    { key: 'Esc', verb: 'close' },
    BACK,
  ],
  'volume-detail-users': [
    { key: '↑↓', verb: 'select' },
    { key: '↵', verb: 'open container' },
    { key: 'y', verb: 'copy' },
    { key: 'Tab', verb: 'next' },
    { key: 'Esc', verb: 'close' },
    BACK,
  ],
  log: [
    { key: 'f', verb: 'follow' },
    { key: 'g', verb: 'top' },
    { key: 'G', verb: 'bottom' },
    { key: '↑↓', verb: 'scroll' },
    { key: 'Esc', verb: 'close' },
    BACK,
  ],
};

/** A container detail panel's hints, by the section holding the cursor. */
export function containerDetailContext(section: string | null): FooterContext {
  if (section === 'env') return 'detail-env';
  if (section === 'mounts') return 'detail-mounts';
  return 'detail';
}

export class Footer {
  readonly box: blessed.Widgets.BoxElement;

  private context: FooterContext = 'global';
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

  setContext(c: FooterContext): void {
    this.context = c;
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
    const hints = HINTS[this.context];
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
