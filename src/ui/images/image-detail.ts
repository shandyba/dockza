import type blessed from 'neo-blessed';
import type { ImageInfo, ImageUser } from '@models/docker';
import type { PanelFocus, ResourceRef } from '@models/nav';
import { t } from '@theme';
import { dateTime, escapeTags, humanSizeMB, oneLine, relativeTime, shortId } from '@utils/format';
import { imageLabel } from '@utils/nav-history';
import { textOption, type CopyOption } from '@ui/copy-menu';
import { allNames } from '@ui/detail/copy-all';
import { DetailPanel, type CopyFn } from '@ui/detail/detail-panel';
import type { PanelSection } from '@ui/detail/panel-section';
import { RefSection } from '@ui/detail/ref-section';
import type { Hint } from '@ui/footer';
import { IMAGE_USERS_ROWS } from '@ui/images/image-users-rows';
import type { ResourceDetail } from '@ui/resource-list-tab';
import { charWidth, type Dims } from '@ui/widgets';

type Handler = () => void;
type SectionHandler = (section: string | null) => void;
type GotoHandler = (ref: ResourceRef) => void;
type MessageHandler = (message: string) => void;

/** Untrusted text (tags, names) for tagged content. */
const safe = (s: string): string => escapeTags(oneLine(s));

/**
 * An image's detail: its tags, size and age, and which containers run it. Tab puts the cursor on
 * USED BY; ↵ there opens that container's detail.
 */
export class ImageDetail implements ResourceDetail<ImageInfo> {
  private readonly panel: DetailPanel;
  private readonly users = new RefSection<ImageUser>(IMAGE_USERS_ROWS, charWidth);
  private image: ImageInfo | null = null;

  constructor(screen: blessed.Widgets.Screen, dims: Dims, copy?: CopyFn) {
    this.panel = new DetailPanel(
      screen,
      dims,
      {
        header: () =>
          ` ${t.purple('DETAIL')} — ${t.fg(safe(this.image ? imageLabel(this.image) : ''))}  ${t.comment('image')}`,
        blocks: () => this.blocks(),
        sections: () => [this.users],
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

  show(image: ImageInfo): void {
    this.image = image;
    this.users.reset(image.users);
    this.panel.show();
  }

  update(image: ImageInfo): void {
    this.image = image;
    this.users.setRows(image.users);
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
    const img = this.image;
    if (!img) return [];
    return [
      textOption('n', 'tag', img.tags[0], 'tag', 'untagged'),
      textOption('i', 'ID', img.id, 'image ID'),
      {
        key: 't',
        label: `all tags (${img.tags.length})`,
        preview: 'tags, one per line',
        text: img.tags.length > 0 ? img.tags.join('\n') : null,
        reason: 'untagged',
        subject: `${img.tags.length} tag${img.tags.length === 1 ? '' : 's'}`,
      },
      allNames(
        img.users.map((u) => u.name),
        'container name',
        'no container uses it',
        'all users',
      ),
    ];
  }

  private blocks(): Array<string | PanelSection> {
    const img = this.image;
    if (!img) return [];
    const n = img.users.length;
    const created =
      img.created.getTime() > 0 ? `${dateTime(img.created)} · ${relativeTime(img.created)}` : '—';
    const tags =
      img.tags.length > 0
        ? img.tags.map((tag) => `   ${t.cyan(safe(tag))}`)
        : [`   ${t.comment('none — a dangling image')}`];

    return [
      `{bold}${t.purple(safe(imageLabel(img)))}{/bold}  ${t.comment(`${shortId(img.id)} · ${humanSizeMB(img.sizeMB)}`)}`,
      img.inUse ? t.green(`● in use · ${n} container${n === 1 ? '' : 's'}`) : t.red('○ unused'),
      ...img.supersededBy.map((tag) => t.orange(`↑ superseded by ${safe(tag)}`)),
      '',
      `${t.comment('Created:')}  ${created}`,
      '',
      t.comment(`TAGS (${img.tags.length})`),
      ...tags,
      '',
      this.users,
      '',
      this.actionsLine(img),
    ];
  }

  private actionsLine(img: ImageInfo): string {
    const remove = img.inUse ? t.faint('[d] Remove (in use)') : t.red('[d] Remove');
    return `  ${remove}  ${t.aqua('[y] Copy')}  ${t.comment('Esc close')}`;
  }
}
