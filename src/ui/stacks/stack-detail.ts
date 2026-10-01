import type blessed from 'neo-blessed';
import type { ContainerInfo, NetworkInfo, VolumeInfo } from '@models/docker';
import type { PanelFocus, ResourceRef } from '@models/nav';
import { t } from '@theme';
import { escapeTags, oneLine } from '@utils/format';
import { NO_STACK, stackCompose, stackResources, type Stack, type StackResources } from '@utils/stacks';
import { textOption, type CopyOption } from '@ui/copy-menu';
import { allNames } from '@ui/detail/copy-all';
import { DetailPanel, type CopyFn } from '@ui/detail/detail-panel';
import type { PanelSection } from '@ui/detail/panel-section';
import { RefSection } from '@ui/detail/ref-section';
import type { Hint } from '@ui/footer';
import { SERVICE_ROWS, STACK_NETWORK_ROWS, STACK_VOLUME_ROWS } from '@ui/stacks/stack-rows';
import { charWidth, type Dims } from '@ui/widgets';

type Handler = () => void;
type SectionHandler = (section: string | null) => void;
type GotoHandler = (ref: ResourceRef) => void;
type MessageHandler = (message: string) => void;

/** Untrusted text (names, paths) for tagged content. */
const safe = (s: string): string => escapeTags(oneLine(s));

/**
 * A stack's detail: its compose project, every container in it, and the volumes and networks the
 * project created. Tab walks SERVICES → VOLUMES → NETWORKS; ↵ opens the row's own detail.
 */
export class StackDetail {
  private readonly panel: DetailPanel;
  private readonly services = new RefSection<ContainerInfo>(SERVICE_ROWS, charWidth);
  private readonly volumes = new RefSection<VolumeInfo>(STACK_VOLUME_ROWS, charWidth);
  private readonly networks = new RefSection<NetworkInfo>(STACK_NETWORK_ROWS, charWidth);
  private stack: Stack | null = null;

  constructor(screen: blessed.Widgets.Screen, dims: Dims, copy?: CopyFn) {
    this.panel = new DetailPanel(
      screen,
      dims,
      {
        header: () => ` ${t.purple('DETAIL')} — ${t.fg(safe(this.stack?.id ?? ''))}  ${t.comment('stack')}`,
        blocks: () => this.blocks(),
        sections: () => [this.services, this.volumes, this.networks],
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

  show(stack: Stack, resources: StackResources): void {
    this.stack = stack;
    const own = stackResources(stack, resources);
    this.services.reset(stack.services);
    this.volumes.reset(own.volumes);
    this.networks.reset(own.networks);
    this.panel.show();
  }

  update(stack: Stack, resources: StackResources): void {
    this.stack = stack;
    const own = stackResources(stack, resources);
    this.services.setRows(stack.services);
    this.volumes.setRows(own.volumes);
    this.networks.setRows(own.networks);
    this.panel.refresh();
  }

  /** Safe to call when hidden (see `DetailPanel.hide`). */
  hide(): void {
    this.panel.hide();
  }

  isVisible(): boolean {
    return this.panel.isVisible();
  }

  getStackId(): string | null {
    return this.stack?.id ?? null;
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
    const s = this.stack;
    if (!s) return [];
    const { configFiles, workingDir } = stackCompose(s);
    const unlabelled = 'not labelled by compose';
    return [
      textOption('n', 'project', s.id === NO_STACK ? null : s.id, 'project', 'not a compose project'),
      {
        ...textOption('f', 'compose files', configFiles.join('\n'), 'compose files', unlabelled),
        preview: configFiles.join(', '),
      },
      textOption('w', 'working dir', workingDir, 'working dir', unlabelled),
      allNames(
        s.services.map((c) => c.compose?.service || c.name),
        'service name',
        'no services',
      ),
    ];
  }

  private blocks(): Array<string | PanelSection> {
    const s = this.stack;
    if (!s) return [];
    const { configFiles, workingDir } = stackCompose(s);
    const { running, errored, stopped } = s.counts;
    // A stack with no compose labels at all was picked out by its `<project>_default` network.
    const kind =
      s.id === NO_STACK
        ? 'containers outside any compose project'
        : s.services.some((c) => c.compose)
          ? 'compose project'
          : `grouped by its ${s.id}_default network`;
    const state = s.isLive ? t.green('● live') : t.faint('○ not running');
    const counts = [
      t.green(`${running} running`),
      errored > 0 ? t.red(`${errored} errored`) : t.comment('0 errored'),
      t.comment(`${stopped} stopped`),
    ].join(t.comment(' · '));
    const files = configFiles.length > 0 ? configFiles.map(safe) : [t.comment('—')];

    return [
      `{bold}${t.purple(safe(s.id))}{/bold}  ${t.comment(safe(kind))}`,
      `${state}  ${counts}`,
      '',
      `${t.comment(configFiles.length > 1 ? 'Files:' : 'File:')}  ${files[0]}`,
      ...files.slice(1).map((f) => `       ${f}`),
      `${t.comment('Dir:')}   ${workingDir ? safe(workingDir) : t.comment('—')}`,
      '',
      this.services,
      '',
      this.volumes,
      '',
      this.networks,
      '',
      this.actionsLine(s),
    ];
  }

  private actionsLine(s: Stack): string {
    const tail = `${t.aqua('[y] Copy')}  ${t.comment('Esc close')}`;
    if (s.id === NO_STACK) return `  ${tail}`;
    if (s.isLive) {
      return `  ${t.red('[s] Stop')}  ${t.green('[r] Restart')}  ${t.orange('[k] Kill')}  ${t.red('[d] Down')}  ${tail}`;
    }
    return `  ${t.green('[S] Start')}  ${t.red('[d] Down')}  ${tail}`;
  }
}
