import blessed from 'neo-blessed';
import { listVolumes, removeVolume } from '@docker/volumes';
import type { VolumeInfo } from '@models/docker';
import { ConfirmDialog } from '@ui/containers/confirm-dialog';
import { t } from '@theme';
import { humanSizeMB, padEnd, truncate } from '@utils/format';
import {
  createCenteredMessage,
  createHeaderBar,
  createListWidget,
  listSelected,
  type Dims,
} from '@ui/widgets';

type ErrorHandler = (message: string) => void;
type NavigateHandler = (volume: VolumeInfo | null) => void;
type ColWidths = [number, number, number, number, number];

export class VolumesTab {
  private screen: blessed.Widgets.Screen;
  private wrapper: blessed.Widgets.BoxElement;
  private headerBox: blessed.Widgets.BoxElement;
  readonly list: blessed.Widgets.ListElement;
  private messageBox: blessed.Widgets.BoxElement;
  private confirmDialog: ConfirmDialog;

  private volumes: VolumeInfo[] = [];
  private active = false;
  private updating = false;
  private errorHandlers: ErrorHandler[] = [];
  private navigateHandlers: NavigateHandler[] = [];

  private readonly handleD = () => {
    if (!this.active || this.confirmDialog.isVisible()) return;
    const vol = this.volumes[listSelected(this.list)];
    if (!vol) return;

    if (vol.inUse) {
      this.emitError('Volume in use — cannot delete');
      return;
    }

    this.confirmDialog.show({
      title: 'Remove volume?',
      message: `${vol.name} will be permanently deleted.`,
      danger: true,
      onConfirm: () => {
        void removeVolume(vol.name)
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
        this.navigateHandlers.forEach((h) => h(this.volumes[index] ?? null));
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

  setData(volumes: VolumeInfo[]): void {
    this.updating = true;

    const prevIdx = listSelected(this.list);
    const prevName = this.volumes[prevIdx]?.name;

    this.volumes = volumes;
    this.messageBox.hide();

    const innerWidth = Math.max(10, (this.list.width as number) - 2);
    const cols = this.calcCols(innerWidth);

    this.renderHeader(cols);

    const items = volumes.map((vol) => this.buildRow(vol, cols));
    this.list.setItems(items as unknown as blessed.Widgets.BlessedElement[]);

    const foundIdx = prevName ? volumes.findIndex((v) => v.name === prevName) : -1;
    const targetIdx = Math.min(foundIdx >= 0 ? foundIdx : prevIdx, Math.max(0, volumes.length - 1));
    this.list.select(targetIdx);

    this.updating = false;

    if (volumes.length === 0) {
      this.messageBox.setContent(t.comment('  No volumes'));
      this.messageBox.show();
    }

    this.emitNavigate();
  }

  async refresh(): Promise<void> {
    const volumes = await listVolumes();
    this.setData(volumes);
  }

  /** Re-render the current dataset (useful after terminal resize). */
  redraw(): void {
    this.setData(this.volumes);
  }

  private emitNavigate(): void {
    this.navigateHandlers.forEach((h) => h(this.volumes[listSelected(this.list)] ?? null));
  }

  private emitError(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    this.errorHandlers.forEach((h) => h(msg));
  }

  private calcCols(inner: number): ColWidths {
    const c1 = Math.floor(inner * 0.28);
    const c2 = Math.floor(inner * 0.12);
    const c3 = Math.floor(inner * 0.3);
    const c4 = Math.floor(inner * 0.1);
    const c5 = Math.max(1, inner - c1 - c2 - c3 - c4);
    return [c1, c2, c3, c4, c5];
  }

  private renderHeader([c1, c2, c3, c4]: ColWidths): void {
    const h1 = padEnd(t.comment(' NAME'), c1 + 1);
    const h2 = padEnd(t.comment('DRIVER'), c2);
    const h3 = padEnd(t.comment('MOUNTPOINT'), c3);
    const h4 = padEnd(t.comment('SIZE'), c4);
    const h5 = t.comment('STATUS');
    this.headerBox.setContent(`${h1}${h2}${h3}${h4}${h5}`);
  }

  private buildRow(vol: VolumeInfo, [c1, c2, c3, c4, c5]: ColWidths): string {
    const col1 = padEnd(truncate(vol.name, c1 - 1), c1);
    const col2 = padEnd(truncate(vol.driver, c2 - 1), c2);
    const col3 = padEnd(t.comment(truncate(vol.mountpoint, c3 - 1)), c3);
    const col4 = padEnd(vol.sizeMB > 0 ? humanSizeMB(vol.sizeMB) : t.comment('—'), c4);
    const col5 = padEnd(vol.inUse ? t.green('● in use') : t.red('○ unused'), c5);
    return `${col1}${col2}${col3}${col4}${col5}`;
  }
}
