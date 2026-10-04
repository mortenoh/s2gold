/**
 * Economy settings windows from the HUD bar: Transport (the ware fetch order,
 * reordered with up/down buttons), Tools (per-tool production weights for the
 * metalworks) and Distribution (which consumer kinds get a scarce ware first).
 * All render from the live session and apply through the engine's commands.
 */

import { el } from '../lib/dom';
import { buildingLabel } from './building-labels';
import { WARE_LABEL } from './inventory-ui';
import type { GameSession } from './session';
import type { WareIconSet } from './ware-icons';

export type PriorityMode = 'transport' | 'tools' | 'distribution';

/** Per-mode window text. */
const MODE_TEXT: Readonly<Record<PriorityMode, { title: string; aria: string; hint: string }>> = {
  transport: {
    title: 'Transport',
    aria: 'Transport priorities',
    hint: 'Wares higher in the list are carried first.',
  },
  tools: {
    title: 'Tools',
    aria: 'Tool production',
    hint: 'How often the metalworks makes each tool (0 = never).',
  },
  distribution: {
    title: 'Distribution',
    aria: 'Ware distribution',
    hint: 'Who gets a scarce ware first: higher weight wins, 0 = none.',
  },
};

export const MAX_DISTRIBUTION_WEIGHT = 10;

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
  /**
   * Values clicked but not yet applied by the engine (commands land on the
   * next tick). Clicks build on these, so pressing "-" five times quickly goes
   * down five steps instead of resending the same value; an entry is dropped
   * once the engine reports it.
   */
  private readonly pending = new Map<string, number>();

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
    this.pending.clear();
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
        'aria-label': MODE_TEXT[this.mode].aria,
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
          text: MODE_TEXT[this.mode].title,
        }),
        closeButton,
      ),
      el('div', {
        class: 'priority-hint',
        text: MODE_TEXT[this.mode].hint,
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
    const key = JSON.stringify(view) + JSON.stringify([...this.pending]);
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
    } else if (this.mode === 'distribution') {
      for (const group of view.distribution) {
        body.append(
          el('div', {
            class: 'priority-group',
            text: WARE_LABEL[group.ware] ?? group.ware,
            attrs: { 'data-group': group.ware },
          }),
        );
        for (const { consumer, weight: applied } of group.consumers) {
          const id = `${group.ware}-${consumer}`;
          const weight = this.settled(`d:${id}`, applied);
          const label =
            consumer === 'construction' ? 'Construction sites' : buildingLabel(consumer);
          body.append(
            this.row(
              group.ware,
              [
                this.control(
                  '-',
                  weight <= 0,
                  () => this.adjustDistribution(group.ware, consumer, applied, -1),
                  `distribution-dec-${id}`,
                ),
                el('span', {
                  class: 'priority-weight',
                  text: String(weight),
                  attrs: { 'data-testid': `distribution-weight-${id}` },
                }),
                this.control(
                  '+',
                  weight >= MAX_DISTRIBUTION_WEIGHT,
                  () => this.adjustDistribution(group.ware, consumer, applied, 1),
                  `distribution-inc-${id}`,
                ),
              ],
              undefined,
              label,
            ),
          );
        }
      }
    } else {
      const weights: Record<string, number> = {};
      for (const [tool, applied] of Object.entries(view.toolWeights)) {
        weights[tool] = this.settled(`t:${tool}`, applied);
      }
      const total = Object.values(weights).reduce((a, b) => a + b, 0);
      for (const [tool, weight] of Object.entries(weights)) {
        body.append(
          this.row(tool, [
            this.control(
              '-',
              weight <= 0 || (weight === 1 && total === 1),
              () => this.setWeight(weights, tool, weight - 1),
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
              () => this.setWeight(weights, tool, weight + 1),
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

  private row(
    ware: string,
    controls: HTMLElement[],
    rank?: number,
    labelOverride?: string,
  ): HTMLElement {
    const text = labelOverride ?? WARE_LABEL[ware] ?? ware;
    const row = el('div', { class: 'priority-row', attrs: { 'data-ware': ware } });
    if (rank !== undefined) row.append(el('span', { class: 'priority-rank', text: String(rank) }));
    const slot = el('span', { class: 'priority-icon', attrs: { 'aria-hidden': 'true' } });
    const icon = el('span', { class: 'production-ware-icon' });
    if (this.deps.icons()?.apply(icon, ware as never)) slot.append(icon);
    row.append(slot);
    row.append(el('span', { class: 'priority-label', text }));
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
      const label = `${action}: ${text}`;
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
    const next = { ...weights, [tool]: Math.max(0, Math.min(MAX_TOOL_WEIGHT, value)) };
    for (const [t, w] of Object.entries(next)) this.pending.set(`t:${t}`, w);
    this.deps.session()?.setToolWeights(next);
  }

  /** The value to show: a pending click until the engine reports it, then the engine's. */
  private settled(key: string, applied: number): number {
    const want = this.pending.get(key);
    if (want === undefined) return applied;
    if (want === applied) {
      this.pending.delete(key);
      return applied;
    }
    return want;
  }

  private adjustDistribution(ware: string, consumer: string, applied: number, delta: number): void {
    const key = `d:${ware}-${consumer}`;
    const base = this.pending.get(key) ?? applied;
    const value = Math.max(0, Math.min(MAX_DISTRIBUTION_WEIGHT, base + delta));
    this.pending.set(key, value);
    this.deps.session()?.setDistribution(ware, consumer, value);
  }
}
