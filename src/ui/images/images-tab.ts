import blessed from 'neo-blessed';
import { listImages, removeImage } from '@docker/images';
import type { ImageInfo } from '@models/docker';
import { ConfirmDialog } from '@ui/containers/confirm-dialog';
import { t } from '@theme';
import { humanSizeMB, padEnd, relativeTime, truncate } from '@utils/format';
import {
  createCenteredMessage,
  createHeaderBar,
  createListWidget,
  listSelected,
  type Dims,
} from '@ui/widgets';

type ErrorHandler = (message: string) => void;
type NavigateHandler = (image: ImageInfo | null) => void;
type ColWidths = [number, number, number, number, number, number];

export class ImagesTab {
  private screen: blessed.Widgets.Screen;
  private wrapper: blessed.Widgets.BoxElement;
  private headerBox: blessed.Widgets.BoxElement;
  readonly list: blessed.Widgets.ListElement;
  private messageBox: blessed.Widgets.BoxElement;
  private confirmDialog: ConfirmDialog;

  private images: ImageInfo[] = [];
  private active = false;
  private updating = false;
  private errorHandlers: ErrorHandler[] = [];
  private navigateHandlers: NavigateHandler[] = [];

  private readonly handleD = () => {
    if (!this.active || this.confirmDialog.isVisible()) return;
    const img = this.images[listSelected(this.list)];
    if (!img) return;

    if (img.inUse) {
      this.emitError('Image in use — cannot delete');
      return;
    }

    this.confirmDialog.show({
      title: 'Remove image?',
      message: `${img.repository}:${img.tag} will be permanently deleted.`,
      danger: true,
      onConfirm: () => {
        void removeImage(img.id)
          .then(() => this.refresh())
          .catch((err: unknown) => this.emitError(err))
          .finally(() => {
            this.list.focus();
            this.screen.render();
          });
      },
      onCancel: () => {
        this.list.focus();
        this.screen.render();
      },
    });
  };

  constructor(screen: blessed.Widgets.Screen, dims: Dims) {
    this.screen = screen;

    this.wrapper = blessed.box({
      parent: screen,
      top: dims.top,
      left: dims.left,
      width: dims.width,
      height: dims.height,
      hidden: true,
    });

    this.headerBox = createHeaderBar(this.wrapper);
    this.list = createListWidget(this.wrapper);
    this.messageBox = createCenteredMessage(this.wrapper);

    this.list.on('select item', (_item: unknown, index: number) => {
      if (!this.updating) {
        this.navigateHandlers.forEach((h) => h(this.images[index] ?? null));
      }
    });

    this.confirmDialog = new ConfirmDialog(screen);
  }

  on(event: 'error', handler: ErrorHandler): void;
  on(event: 'navigate', handler: NavigateHandler): void;
  on(event: 'error' | 'navigate', handler: ErrorHandler | NavigateHandler): void {
    if (event === 'error') this.errorHandlers.push(handler as ErrorHandler);
    if (event === 'navigate') this.navigateHandlers.push(handler as NavigateHandler);
  }

  isConfirmOpen(): boolean {
    return this.confirmDialog.isVisible();
  }

  showLoading(): void {
    this.messageBox.setContent(t.comment('  Loading...'));
    this.messageBox.show();
  }

  show(): void {
    this.active = true;
    this.wrapper.show();
    this.list.focus();
    this.screen.key(['d'], this.handleD);
    this.emitNavigate();
  }

  hide(): void {
    this.active = false;
    this.wrapper.hide();
    this.screen.removeKey('d', this.handleD);
  }

  setData(images: ImageInfo[]): void {
    this.updating = true;

    const prevIdx = listSelected(this.list);
    const prevId = this.images[prevIdx]?.id;

    this.images = images;
    this.messageBox.hide();

    const innerWidth = Math.max(10, (this.list.width as number) - 2);
    const cols = this.calcCols(innerWidth);

    this.renderHeader(cols);

    const items = images.map((img) => this.buildRow(img, cols));
    this.list.setItems(items as unknown as blessed.Widgets.BlessedElement[]);

    const foundIdx = prevId ? images.findIndex((i) => i.id === prevId) : -1;
    const targetIdx = Math.min(foundIdx >= 0 ? foundIdx : prevIdx, Math.max(0, images.length - 1));
    this.list.select(targetIdx);

    this.updating = false;

    if (images.length === 0) {
      this.messageBox.setContent(t.comment('  No images'));
      this.messageBox.show();
    }

    this.emitNavigate();
  }

  async refresh(): Promise<void> {
    const images = await listImages();
    this.setData(images);
  }

  redraw(): void {
    this.setData(this.images);
  }

  private emitNavigate(): void {
    this.navigateHandlers.forEach((h) => h(this.images[listSelected(this.list)] ?? null));
  }

  private emitError(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    this.errorHandlers.forEach((h) => h(msg));
  }

  private calcCols(inner: number): ColWidths {
    const c1 = Math.floor(inner * 0.25);
    const c2 = Math.floor(inner * 0.12);
    const c3 = Math.floor(inner * 0.1);
    const c4 = Math.floor(inner * 0.15);
    const c5 = Math.floor(inner * 0.1);
    const c6 = Math.max(1, inner - c1 - c2 - c3 - c4 - c5);
    return [c1, c2, c3, c4, c5, c6];
  }

  private renderHeader([c1, c2, c3, c4, c5]: ColWidths): void {
    const h1 = padEnd(t.comment(' REPOSITORY'), c1 + 1);
    const h2 = padEnd(t.comment('TAG'), c2);
    const h3 = padEnd(t.comment('ID'), c3);
    const h4 = padEnd(t.comment('CREATED'), c4);
    const h5 = padEnd(t.comment('SIZE'), c5);
    const h6 = t.comment('STATUS');
    this.headerBox.setContent(`${h1}${h2}${h3}${h4}${h5}${h6}`);
  }

  private buildRow(img: ImageInfo, [c1, c2, c3, c4, c5, c6]: ColWidths): string {
    const col1 = padEnd(truncate(img.repository, c1 - 1), c1);
    const col2 = padEnd(t.cyan(truncate(img.tag, c2 - 1)), c2);
    const shortId = img.id.replace('sha256:', '').slice(0, 12);
    const col3 = padEnd(t.comment(shortId), c3);
    const col4 = padEnd(t.comment(relativeTime(img.created)), c4);
    const col5 = padEnd(humanSizeMB(img.sizeMB), c5);
    const col6 = padEnd(img.inUse ? t.green('● in use') : t.red('○ unused'), c6);
    return `${col1}${col2}${col3}${col4}${col5}${col6}`;
  }
}
