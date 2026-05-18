import blessed from 'neo-blessed';
import { streamLogs } from '@docker/containers';
import type { ContainerInfo } from '@models/docker';
import { C, t } from '@theme';
import type { Dims } from '@ui/widgets';

type CloseHandler = () => void;
type FollowChangeHandler = (following: boolean) => void;

export class LogViewer {
  private screen: blessed.Widgets.Screen;
  private wrapper: blessed.Widgets.BoxElement;
  private headerBox: blessed.Widgets.BoxElement;
  private logBox: blessed.Widgets.Log;

  private visible = false;
  private following = true;
  private activeStream: (NodeJS.ReadableStream & { destroy?: () => void }) | null = null;
  private streamGen = 0;
  private pending: Buffer = Buffer.alloc(0);
  private containerName = '';

  private closeHandlers: CloseHandler[] = [];
  private followChangeHandlers: FollowChangeHandler[] = [];

  private readonly handleF = () => {
    if (!this.visible) return;
    this.following = !this.following;
    this.followChangeHandlers.forEach((h) => h(this.following));
    this.screen.render();
  };

  private readonly handleG = () => {
    if (!this.visible) return;
    this.logBox.setScrollPerc(0);
    this.screen.render();
  };

  private readonly handleShiftG = () => {
    if (!this.visible) return;
    this.following = true;
    this.logBox.setScrollPerc(100);
    this.followChangeHandlers.forEach((h) => h(this.following));
    this.screen.render();
  };

  private readonly handleUp = () => {
    if (!this.visible) return;
    this.following = false;
    this.logBox.scroll(-1);
    this.followChangeHandlers.forEach((h) => h(this.following));
    this.screen.render();
  };

  private readonly handleClose = () => {
    if (!this.visible) return;
    this.hide();
    this.closeHandlers.forEach((h) => h());
  };

  constructor(screen: blessed.Widgets.Screen, dims: Dims) {
    this.screen = screen;

    this.wrapper = blessed.box({
      parent: screen,
      top: dims.top,
      left: dims.left,
      width: dims.width,
      height: dims.height,
      style: { bg: C.bg },
      hidden: true,
    });

    this.headerBox = blessed.box({
      parent: this.wrapper,
      top: 0,
      left: 0,
      height: 1,
      width: '100%',
      tags: true,
      style: { bg: C.bgSel },
    });

    this.logBox = blessed.log({
      parent: this.wrapper,
      top: 1,
      left: 0,
      height: '100%-1',
      width: '100%',
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
      tags: true,
      alwaysScroll: true,
      // Cap retained lines so a chatty container can't grow this without bound.
      scrollback: 5000,
      scrollbar: { ch: '│', style: { fg: C.comment } },
      style: { fg: C.fg, bg: C.bg },
    });
  }

  on(event: 'close', handler: CloseHandler): void;
  on(event: 'follow-change', handler: FollowChangeHandler): void;
  on(event: 'close' | 'follow-change', handler: CloseHandler | FollowChangeHandler): void {
    if (event === 'close') this.closeHandlers.push(handler as CloseHandler);
    if (event === 'follow-change') this.followChangeHandlers.push(handler as FollowChangeHandler);
  }

  show(container: ContainerInfo): void {
    this.containerName = container.name;
    this.following = true;

    this.logBox.setContent('');
    this.logBox.setScrollPerc(0);

    this.visible = true;
    this.wrapper.show();
    this.logBox.focus();
    this.updateHeader();

    this.screen.key(['f'], this.handleF);
    this.screen.key(['g'], this.handleG);
    this.screen.key(['S-g'], this.handleShiftG);
    this.screen.key(['up', 'k'], this.handleUp);
    this.screen.key(['escape'], this.handleClose);

    this.screen.render();

    this.pending = Buffer.alloc(0);
    const myGen = ++this.streamGen;

    void streamLogs(container.id, 200)
      .then((stream) => {
        if (myGen !== this.streamGen) {
          (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
          return;
        }
        this.activeStream = stream as NodeJS.ReadableStream & { destroy?: () => void };

        stream.on('data', (chunk: Buffer) => {
          if (myGen !== this.streamGen) return;
          this.parseFrames(chunk);
          if (this.following) this.logBox.setScrollPerc(100);
          this.screen.render();
        });

        stream.on('error', (err: Error) => {
          if (myGen !== this.streamGen) return;
          this.logBox.pushLine(t.red(`Stream error: ${err.message}`));
          this.screen.render();
        });
      })
      .catch((err: unknown) => {
        if (myGen !== this.streamGen) return;
        this.logBox.pushLine(
          t.red(`Failed to open log stream: ${err instanceof Error ? err.message : String(err)}`),
        );
        this.screen.render();
      });
  }

  hide(): void {
    this.visible = false;
    this.streamGen++;
    this.pending = Buffer.alloc(0);

    if (this.activeStream) {
      this.activeStream.destroy?.();
      this.activeStream = null;
    }

    this.wrapper.hide();

    this.screen.removeKey('f', this.handleF);
    this.screen.removeKey('g', this.handleG);
    this.screen.removeKey('S-g', this.handleShiftG);
    this.screen.removeKey('up', this.handleUp);
    this.screen.removeKey('k', this.handleUp);
    this.screen.removeKey('escape', this.handleClose);

    this.screen.render();
  }

  isVisible(): boolean {
    return this.visible;
  }

  private updateHeader(): void {
    this.headerBox.setContent(` ${t.purple('LOGS')} — ${t.fg(this.containerName)}`);
  }

  private parseFrames(chunk: Buffer): void {
    const buf = this.pending.length > 0 ? Buffer.concat([this.pending, chunk]) : chunk;
    let offset = 0;
    while (offset + 8 <= buf.length) {
      const type = buf[offset];
      const size = buf.readUInt32BE(offset + 4);
      if (offset + 8 + size > buf.length) break;
      const message = buf.slice(offset + 8, offset + 8 + size).toString('utf8');
      offset += 8 + size;

      for (const line of message.split('\n')) {
        if (!line) continue;
        this.logBox.pushLine(type === 2 ? t.orange(line) : line);
      }
    }
    this.pending = offset < buf.length ? buf.slice(offset) : Buffer.alloc(0);
  }
}
