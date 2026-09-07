/**
 * Building window for own production buildings (the original's per-building
 * window): name, worker/progress state, input stock with ware pictographs,
 * queued output, a Stop/Resume production toggle, Build road and Demolish.
 * Opens on a click at the building; live-refreshes while open.
 */

import { el } from '../lib/dom';
import { BuildingPanel } from './building-panel';
import { buildingLabel } from './building-labels';
import { WARE_LABEL } from './inventory-ui';
import type { GameSession, ProductionView } from './session';
import type { WareIconSet } from './ware-icons';

export interface ProductionPanelDeps {
  readonly root: HTMLElement;
  session(): GameSession;
  /** Ware pictographs (null when the object atlas is missing: text only). */
  icons(): WareIconSet | null;
  /** Enter road mode from the building's flag. */
  buildRoad(flagNode: number): void;
  demolish(node: number): void;
}

export class ProductionPanel extends BuildingPanel {
  constructor(private readonly deps: ProductionPanelDeps) {
    super(deps.root, 'military-panel production-panel', 'production-panel');
  }

  protected idAt(node: number): number {
    return this.deps.session().productionAt(node)?.buildingId ?? -1;
  }

  protected renderBody(panel: HTMLElement): void {
    const view = this.deps.session().productionAt(this.node);
    if (!view) return;
    panel.append(
      el(
        'div',
        { class: 'mil-title', attrs: { 'data-testid': 'production-title' } },
        el('span', { text: buildingLabel(view.type) }),
        el('span', { class: 'mil-owner', text: view.site ? 'Under construction' : 'Yours' }),
      ),
    );
    panel.append(
      el('div', {
        class: 'mil-sub',
        text: statusText(view),
        attrs: { 'data-testid': 'production-status' },
      }),
    );
    if (view.site) {
      panel.append(
        el('div', {
          class: 'mil-rank',
          text: `Boards ${view.deliveredBoards}/${view.needBoards}  Stones ${view.deliveredStones}/${view.needStones}`,
          attrs: { 'data-testid': 'production-materials' },
        }),
      );
    } else {
      if (view.inputs.length > 0) panel.append(this.inputRows(view));
      if (view.outputs.length > 0) {
        panel.append(
          el('div', {
            class: 'mil-rank',
            text: `Makes ${view.outputs.map((w) => WARE_LABEL[w] ?? w).join(' / ')}${view.queued > 0 ? ` (${view.queued} waiting at the door)` : ''}`,
            attrs: { 'data-testid': 'production-output' },
          }),
        );
      }
    }
    const actions = el('div', { class: 'mil-actions' });
    if (!view.site) {
      actions.append(
        this.button(
          view.stopped ? 'Resume production' : 'Stop production',
          () => {
            this.deps.session().toggleProduction(view.buildingId, !view.stopped);
            this.render();
          },
          'production-toggle',
        ),
      );
    }
    if (view.flagNode >= 0) {
      actions.append(
        this.button(
          'Build road',
          () => {
            const flag = view.flagNode;
            this.close();
            this.deps.buildRoad(flag);
          },
          'production-road',
        ),
      );
    }
    actions.append(
      this.button(
        'Demolish',
        () => {
          const node = this.node;
          this.close();
          this.deps.demolish(node);
        },
        'production-demolish',
      ),
      this.button('Close', () => this.close(), 'production-close'),
    );
    panel.append(actions);
  }

  private inputRows(view: ProductionView): HTMLElement {
    const box = el('div', { class: 'mil-garrison', attrs: { 'data-testid': 'production-inputs' } });
    box.append(el('div', { class: 'mil-sub', text: 'Stock' }));
    const icons = this.deps.icons();
    for (const input of view.inputs) {
      const row = el('div', {
        class: 'mil-rank production-input',
        attrs: { 'data-ware': input.ware },
      });
      const icon = el('span', { class: 'production-ware-icon' });
      const drawn = icons?.apply(icon, input.ware as never) ?? false;
      if (drawn) row.append(icon);
      row.append(
        el('span', { text: `${WARE_LABEL[input.ware] ?? input.ware} ${input.count}/${input.cap}` }),
      );
      box.append(row);
    }
    return box;
  }
}

function statusText(view: ProductionView): string {
  if (view.site) return `Building: ${Math.round(view.buildProgress * 100)}%`;
  if (!view.staffed) return view.workerOnWay ? 'Worker on the way' : 'Waiting for a worker (tool?)';
  if (view.stopped) return view.working ? 'Finishing, then stopping' : 'Production stopped';
  return view.working ? 'Working' : 'Idle';
}
