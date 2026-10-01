import type blessed from 'neo-blessed';
import type { VolumeInfo, VolumeUser } from '@models/docker';
import type { PanelFocus, ResourceRef } from '@models/nav';
import { t } from '@theme';
import { dateTime, escapeTags, humanSizeMB, oneLine, relativeTime } from '@utils/format';
import { textOption, type CopyOption } from '@ui/copy-menu';
import { allNames } from '@ui/detail/copy-all';
import { DetailPanel, type CopyFn } from '@ui/detail/detail-panel';
import type { PanelSection } from '@ui/detail/panel-section';
import { RefSection } from '@ui/detail/ref-section';
import { relatedRows, type RelatedRow } from '@ui/detail/related-rows';
import type { Hint } from '@ui/footer';
import type { ResourceDetail } from '@ui/resource-list-tab';
import { usedByRows } from '@ui/volumes/used-by-rows';
import { volumeRelated } from '@ui/volumes/volume-related';
import { charWidth, type Dims } from '@ui/widgets';

type Handler = () => void;
type SectionHandler = (section: string | null) => void;
type GotoHandler = (ref: ResourceRef) => void;
type MessageHandler = (message: string) => void;

/** Untrusted text (labels, names) for tagged content. */
const safe = (s: string): string => escapeTags(oneLine(s));

/**
 * A volume's detail: what it is, where its data lives, where it came from (RELATED), and which
 * containers mount it. Tab walks RELATED → USED BY; ↵ opens the stack or container a row names.
 */
export class VolumeDetail implements ResourceDetail<VolumeInfo> {
  private readonly panel: DetailPanel;
  private readonly related = new RefSection<RelatedRow>(
    relatedRows('none — no compose or anonymous labels'),
    charWidth,
  );
  private readonly users: RefSection<VolumeUser>;
  private volume: VolumeInfo | null = null;

  constructor(screen: blessed.Widgets.Screen, dims: Dims, copy?: CopyFn) {
    this.users = new RefSection(
      usedByRows(() => this.volume?.name ?? ''),
      charWidth,
    );
    this.panel = new DetailPanel(
      screen,
      dims,
      {
        header: () =>
          ` ${t.purple('DETAIL')} — ${t.fg(safe(this.volume?.name ?? ''))}  ${t.comment('volume')}`,
        blocks: () => this.blocks(),
        sections: () => [this.related, this.users],
        subjectCopy: () => this.subjectCopy(),
      },
      copy,
    );
  }

  get box(): blessed.Widgets.BoxElement {
    return this.panel.box;
  }

  on(event: 'close-request', handler: Handler): void;
  on(event: 'section', handler: SectionHandler): void;
  on(event: 'goto', handler: GotoHandler): void;
  on(event: 'info' | 'error', handler: MessageHandler): void;
  on(
    event: 'close-request' | 'section' | 'goto' | 'info' | 'error',
    handler: Handler | SectionHandler | GotoHandler | MessageHandler,
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the overloads above keep callers typed
    this.panel.on(event as any, handler as any);
  }

  show(volume: VolumeInfo): void {
    this.volume = volume;
    this.related.reset(volumeRelated(volume));
    this.users.reset(volume.users);
    this.panel.show();
  }

  update(volume: VolumeInfo): void {
    this.volume = volume;
    this.related.setRows(volumeRelated(volume));
    this.users.setRows(volume.users);
    this.panel.refresh();
  }

  /** Safe to call when hidden (see `DetailPanel.hide`). */
  hide(): void {
    this.panel.hide();
  }

  isVisible(): boolean {
    return this.panel.isVisible();
  }

  focusedSection(): string | null {
    return this.panel.focusedSection();
  }

  focusedHints(): Hint[] | null {
    return this.panel.focusedHints();
  }

  getFocus(): PanelFocus | undefined {
    return this.panel.getFocus();
  }

  setFocus(focus: PanelFocus | undefined): void {
    this.panel.setFocus(focus);
  }

  private subjectCopy(): CopyOption[] {
    const v = this.volume;
    if (!v) return [];
    return [
      textOption('n', 'name', v.name, 'volume name'),
      textOption('p', 'mountpoint', v.mountpoint, 'mountpoint'),
      allNames(
        v.users.map((u) => u.name),
        'container name',
        'no container uses it',
        'all users',
      ),
    ];
  }

  private blocks(): Array<string | PanelSection> {
    const v = this.volume;
    if (!v) return [];
    const size = v.sizeMB > 0 ? humanSizeMB(v.sizeMB) : '—';
    const n = new Set(v.users.map((u) => u.id)).size;
    const created = v.created.getTime() > 0 ? `${dateTime(v.created)} · ${relativeTime(v.created)}` : '—';

    return [
      `{bold}${t.purple(safe(v.name))}{/bold}  ${t.comment(`${safe(v.driver)} · ${size}`)}`,
      v.inUse
        ? t.green(`● in use · ${n} container${n === 1 ? '' : 's'}`)
        : t.red(v.orphaned ? '○ orphaned' : '○ unused'),
      '',
      `${t.comment('Created:')}     ${created}`,
      `${t.comment('Mountpoint:')}  ${safe(v.mountpoint)}`,
      '',
      this.related,
      '',
      this.users,
      '',
      this.actionsLine(v),
    ];
  }

  private actionsLine(v: VolumeInfo): string {
    const remove = v.inUse ? t.faint('[d] Remove (in use)') : t.red('[d] Remove');
    return `  ${remove}  ${t.aqua('[y] Copy')}  ${t.comment('Esc close')}`;
  }
}
