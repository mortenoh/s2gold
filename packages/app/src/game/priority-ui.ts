/**
 * Economy settings windows from the HUD bar: Transport (the ware fetch order,
 * reordered with up/down buttons) and Tools (per-tool production weights for
 * the metalworks). Both render from the live session and apply through the
 * engine's priority commands.
 */

import { el } from '../lib/dom';
import { WARE_LABEL } from './inventory-ui';
import type { GameSession } from './session';
import type { WareIconSet } from './ware-icons';

export type PriorityMode = 'transport' | 'tools';

export interface PriorityPanelDeps {
  readonly root: HTMLElement;
  session(): GameSession | null;
  icons(): WareIconSet | null;
  onVisibility?(open: boolean): void;
}

export const MAX_TOOL_WEIGHT = 10;

export class PriorityPanel {
  private panel: HTMLElement | null = null;
  /** Live refresh while open: commands apply on the next engine tick. */
  private refreshTimer = 0;

  constructor(
    private readonly deps: PriorityPanelDeps,
    private readonly mode: PriorityMode,
  ) {}

  get isOpen(): boolean {
    return this.panel !== null;
  }

  get element(): HTMLElement | null {
    return this.panel;
  }

  close(): void {
    if (this.refreshTimer) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = 0;
    }
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
    }
    this.deps.onVisibility?.(false);
  }

  open(): void {
    if (!this.deps.session()) return;
    this.close();
    const panel = el('div', {
      class: `goods-panel priority-panel priority-${this.mode}`,
      attrs: {
        'data-testid': `${this.mode}-panel`,
        role: 'dialog',
        'aria-label': this.mode === 'transport' ? 'Transport priorities' : 'Tool production',
      },
    });
    const closeButton = el('button', {
      text: '✕',
      attrs: { type: 'button', 'data-testid': `${this.mode}-close`, title: 'Close' },
    });
    closeButton.addEventListener('click', () => this.close());
    panel.append(
      el(
        'div',
        { class: 'goods-panel-head' },
        el('span', {
          class: 'goods-panel-title',
          text: this.mode === 'transport' ? 'Transport' : 'Tools',
        }),
        closeButton,
      ),
      el('div', {
        class: 'priority-hint',
        text:
          this.mode === 'transport'
            ? 'Wares higher in the list are carried first.'
            : 'How often the metalworks makes each tool (0 = never).',
      }),
      el('div', { class: 'priority-body', attrs: { 'data-testid': `${this.mode}-list` } }),
    );
    this.panel = panel;
    this.deps.root.append(panel);
    this.render();
    this.refreshTimer = window.setInterval(() => this.render(), 250);
    this.deps.onVisibility?.(true);
  }

  /** Re-render the list from the session (called after each change). */
  private lastKey = '';

  render(): void {
    const session = this.deps.session();
    const body = this.panel?.querySelector<HTMLElement>('.priority-body');
    if (!session || !body) return;
    const view = session.priorities();
    const key = JSON.stringify(view);
    if (key === this.lastKey && body.childElementCount > 0) return;
    this.lastKey = key;
    const scrollTop = body.scrollTop;
    const focused = body.contains(document.activeElement)
      ? document.activeElement?.getAttribute('data-testid')
      : null;
    body.replaceChildren();
    if (this.mode === 'transport') {
      view.transport.forEach((ware, i) => {
        body.append(
          this.row(
            ware,
            [
              this.control(
                '▲',
                i === 0,
                () => this.moveTransport(view.transport, i, -1),
                `transport-up-${ware}`,
              ),
              this.control(
                '▼',
                i === view.transport.length - 1,
                () => this.moveTransport(view.transport, i, 1),
                `transport-down-${ware}`,
              ),
            ],
            i + 1,
          ),
        );
      });
    } else {
      const total = Object.values(view.toolWeights).reduce((a, b) => a + b, 0);
      for (const [tool, weight] of Object.entries(view.toolWeights)) {
        body.append(
          this.row(tool, [
            this.control(
              '-',
              weight <= 0 || (weight === 1 && total === 1),
              () => this.setWeight(view.toolWeights, tool, weight - 1),
              `tools-dec-${tool}`,
            ),
            el('span', {
              class: 'priority-weight',
              text: String(weight),
              attrs: { 'data-testid': `tools-weight-${tool}` },
            }),
            this.control(
              '+',
              weight >= MAX_TOOL_WEIGHT,
              () => this.setWeight(view.toolWeights, tool, weight + 1),
              `tools-inc-${tool}`,
            ),
          ]),
        );
      }
    }
    body.scrollTop = scrollTop;
    if (focused)
      body.querySelector<HTMLElement>(`[data-testid="${focused}"]`)?.focus({ preventScroll: true });
  }

  private row(ware: string, controls: HTMLElement[], rank?: number): HTMLElement {
    const row = el('div', { class: 'priority-row', attrs: { 'data-ware': ware } });
    if (rank !== undefined) row.append(el('span', { class: 'priority-rank', text: String(rank) }));
    const slot = el('span', { class: 'priority-icon', attrs: { 'aria-hidden': 'true' } });
    const icon = el('span', { class: 'production-ware-icon' });
    if (this.deps.icons()?.apply(icon, ware as never)) slot.append(icon);
    row.append(slot);
    row.append(el('span', { class: 'priority-label', text: WARE_LABEL[ware] ?? ware }));
    for (const control of controls) {
      if (control.tagName !== 'BUTTON') continue;
      const action =
        control.textContent === '▲'
          ? 'Move up'
          : control.textContent === '▼'
            ? 'Move down'
            : control.textContent === '+'
              ? 'Increase'
              : 'Decrease';
      const label = `${action}: ${WARE_LABEL[ware] ?? ware}`;
      control.setAttribute('aria-label', label);
      control.title = label;
    }
    row.append(el('span', { class: 'priority-controls' }, ...controls));
    return row;
  }

  private control(text: string, disabled: boolean, run: () => void, testid: string): HTMLElement {
    const btn = el('button', {
      text,
      attrs: { type: 'button', 'data-testid': testid },
    }) as HTMLButtonElement;
    btn.disabled = disabled;
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      run();
      this.render();
    });
    return btn;
  }

  private moveTransport(order: readonly string[], index: number, delta: number): void {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    this.deps.session()?.setTransportOrder(next);
  }

  private setWeight(weights: Readonly<Record<string, number>>, tool: string, value: number): void {
    this.deps.session()?.setToolWeights({ ...weights, [tool]: value });
  }
}
