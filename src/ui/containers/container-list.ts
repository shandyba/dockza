import blessed from 'neo-blessed';
import type { ContainerInfo } from '@models/docker';
import { t } from '@theme';
import { padEnd, truncate } from '@utils/format';
import { formatFirst } from '@utils/list-cells';
import { shownImage } from '@utils/outdated';
import { formatPort } from '@utils/ports';
import { colorByStatus, formatCpuCell, formatMemCell, statusDot, statusLabel } from '@utils/status';
import {
  createCenteredMessage,
  createHeaderBar,
  createListWidget,
  listSelected,
  type Dims,
} from '@ui/widgets';

export interface RowStats {
  cpuPercent: number;
  memPercent: number;
}

type ColWidths = [number, number, number, number, number, number, number];

type SelectHandler = (container: ContainerInfo) => void;
type NavigateHandler = (container: ContainerInfo | null) => void;

export class ContainerList {
  private wrapper: blessed.Widgets.BoxElement;
  private header: blessed.Widgets.BoxElement;
  readonly list: blessed.Widgets.ListElement;
  private messageBox: blessed.Widgets.BoxElement;

  private containers: ContainerInfo[] = [];
  private selectHandlers: SelectHandler[] = [];
  private navigateHandlers: NavigateHandler[] = [];

  constructor(parent: blessed.Widgets.Screen | blessed.Widgets.BoxElement, dims: Dims) {
    this.wrapper = blessed.box({
      parent,
      top: dims.top,
      left: dims.left,
      width: dims.width,
      height: dims.height,
    });

    this.header = createHeaderBar(this.wrapper);
    this.list = createListWidget(this.wrapper);
    this.messageBox = createCenteredMessage(this.wrapper);

    this.list.on('select', (_item: unknown, index: number) => {
      const container = this.containers[index];
      if (container) this.selectHandlers.forEach((h) => h(container));
    });

    this.list.on('select item', (_item: unknown, index: number) => {
      const container = this.containers[index] ?? null;
      this.navigateHandlers.forEach((h) => h(container));
    });

    this.list.on('click', () => {
      const container = this.containers[listSelected(this.list)];
      if (container) this.selectHandlers.forEach((h) => h(container));
    });
  }

  on(event: 'select', handler: SelectHandler): void;
  on(event: 'navigate', handler: NavigateHandler): void;
  on(event: 'select' | 'navigate', handler: SelectHandler | NavigateHandler): void {
    if (event === 'select') this.selectHandlers.push(handler as SelectHandler);
    if (event === 'navigate') this.navigateHandlers.push(handler as NavigateHandler);
  }

  showLoading(): void {
    this.messageBox.setContent(t.comment('  Loading...'));
    this.messageBox.show();
  }

  /** `emptyMessage` shows when there are no rows (with a filter on, say what didn't match). */
  setData(containers: ContainerInfo[], stats?: Map<string, RowStats>, emptyMessage = 'No containers'): void {
    this.containers = containers;
    this.messageBox.hide();

    const innerWidth = Math.max(10, (this.list.width as number) - 2);
    const cols = this.calcColWidths(innerWidth);

    this.renderHeader(cols);

    const items = containers.map((c) => this.buildRow(c, cols, stats?.get(c.id)));
    this.list.setItems(items as unknown as blessed.Widgets.BlessedElement[]);

    if (containers.length === 0) {
      this.messageBox.setContent(t.comment(`  ${emptyMessage}`));
      this.messageBox.show();
    }
  }

  getSelected(): ContainerInfo | null {
    return this.containers[listSelected(this.list)] ?? null;
  }

  focus(): void {
    this.list.focus();
  }

  show(): void {
    this.wrapper.show();
  }

  hide(): void {
    this.wrapper.hide();
  }

  private calcColWidths(inner: number): ColWidths {
    const c1 = Math.floor(inner * 0.21);
    const c2 = Math.floor(inner * 0.17);
    const c3 = Math.floor(inner * 0.22);
    const c4 = Math.floor(inner * 0.1);
    const c5 = Math.floor(inner * 0.08);
    const c6 = Math.floor(inner * 0.08);
    const c7 = Math.max(1, inner - c1 - c2 - c3 - c4 - c5 - c6);
    return [c1, c2, c3, c4, c5, c6, c7];
  }

  private renderHeader([c1, c2, c3, c4, c5, c6]: ColWidths): void {
    const h1 = padEnd(t.comment(' NAME'), c1 + 1);
    const h2 = padEnd(t.comment('IMAGE'), c2);
    const h3 = padEnd(t.comment('STATUS & UPTIME'), c3);
    const h4 = padEnd(t.comment('NET'), c4);
    const h5 = padEnd(t.comment('CPU'), c5);
    const h6 = padEnd(t.comment('MEM'), c6);
    const h7 = t.comment('PORTS');
    this.header.setContent(`${h1}${h2}${h3}${h4}${h5}${h6}${h7}`);
  }

  private buildRow(c: ContainerInfo, [c1, c2, c3, c4, c5, c6, c7]: ColWidths, stats?: RowStats): string {
    const nameRaw = truncate(c.name, Math.max(1, c1 - 2));
    const col1 = padEnd(`${statusDot(c)} ${nameRaw}`, c1);

    // An orange ↑: a newer image carries the tag it was created from (the detail says which).
    const mark = c.outdated ? `${t.orange('↑')} ` : '';
    const imageRaw = truncate(shownImage(c), Math.max(1, c2 - 1 - (mark ? 2 : 0)));
    const col2 = padEnd(`${mark}${t.comment(imageRaw)}`, c2);

    const stateRaw = `${statusLabel(c)} · ${c.uptime}`;
    const col3 = padEnd(colorByStatus(c, truncate(stateRaw, c3 - 1)), c3);

    const networks = c.networks.map((n) => n.name);
    const col4 = padEnd(formatFirst(networks, c4, t.cyan), c4);

    const col5 = padEnd(formatCpuCell(c, stats?.cpuPercent), c5);
    const col6 = padEnd(formatMemCell(c, stats?.memPercent), c6);

    // One column short of the row's room: a row as wide as the item (the scrollbar takes a column)
    // makes blessed wrap it at a space near its end, and `+N` vanishes onto a hidden second line.
    const col7 = formatFirst(c.ports.map(formatPort), c7 - 1, t.pink);

    return `${col1}${col2}${col3}${col4}${col5}${col6}${col7}`;
  }
}
