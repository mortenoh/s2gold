/**
 * Harbor panel: opens when the player clicks one of their own working harbors.
 *
 * It surfaces the seafaring loop (SEAFARING.md / P7): the warehouse stock that
 * feeds an expedition kit, the pending expedition's assembly progress
 * (boards / stones / builder from {@link GameSession.expeditionAt}), and the two
 * actions —
 *   - Prepare expedition: queues the engine `prepareExpedition` command, which
 *     draws boards + stones + a builder from the player pool over the next ticks.
 *   - Start expedition: enabled once the kit is ready AND an idle ship is homed
 *     here; it hands control to the interaction layer's target-select mode, where
 *     the next map click on a coastal spot launches the ship (`startExpedition`).
 *
 * The panel polls the live engine snapshot while open so assembly progress and a
 * launched expedition's disappearance stay current (mirrors the military panel).
 */

import { el } from '../lib/dom';
import { BuildingPanel } from './building-panel';
import type { GameSession } from './session';

/** Dependencies the panel reads live (they change on map switch). */
export interface HarborPanelDeps {
  readonly root: HTMLElement;
  session(): GameSession;
  /** Enter expedition target-select mode for a ready harbor (interaction layer). */
  beginExpeditionTarget(harborId: number): void;
}

export class HarborPanel extends BuildingPanel {
  /** The tracked harbor's building id while open (-1 otherwise). */
  private harborId = -1;

  constructor(private readonly deps: HarborPanelDeps) {
    super(deps.root, 'military-panel harbor-panel', 'harbor-panel');
  }

  protected idAt(node: number): number {
    return this.deps.session().harborAt(node)?.id ?? -1;
  }

  protected renderBody(panel: HTMLElement, trackedId: number): void {
    this.harborId = trackedId;
    const session = this.deps.session();
    panel.append(
      el(
        'div',
        { class: 'mil-title', attrs: { 'data-testid': 'harbor-title' } },
        el('span', { text: 'Harbor' }),
        el('span', { class: 'mil-owner', text: 'Yours' }),
      ),
    );
    panel.append(this.stockRow(session));
    panel.append(this.expeditionSection(session));
    panel.append(
      el(
        'div',
        { class: 'mil-actions' },
        this.button('Close', () => this.close(), 'harbor-close'),
      ),
    );
  }

  private stockRow(session: GameSession): HTMLElement {
    const inv = session.inventory;
    const ships = session.ships().filter((s) => s.homeHarborId === this.harborId).length;
    return el(
      'div',
      { class: 'mil-garrison', attrs: { 'data-testid': 'harbor-stock' } },
      el('div', { class: 'mil-sub', text: 'Stock (warehouse)' }),
      el('div', { class: 'mil-rank', text: `Boards ${inv.plank}  Stones ${inv.stone}` }),
      el('div', { class: 'mil-rank', text: `Ships homed here: ${ships}` }),
    );
  }

  private expeditionSection(session: GameSession): HTMLElement {
    const exp = session.expeditionAt(this.harborId);
    const wrap = el('div', { class: 'mil-attack', attrs: { 'data-testid': 'expedition-status' } });

    if (!exp) {
      wrap.append(el('div', { class: 'mil-sub', text: 'No expedition' }));
      wrap.append(
        this.button(
          'Prepare expedition',
          () => {
            session.prepareExpedition(this.harborId);
            this.render();
          },
          'prepare-expedition',
        ),
      );
      return wrap;
    }

    const builder = exp.hasBuilder ? 'yes' : 'no';
    wrap.append(
      el('div', {
        class: 'mil-sub',
        text: exp.ready ? 'Expedition ready' : 'Assembling expedition',
      }),
    );
    wrap.append(
      el('div', {
        class: 'mil-rank',
        text: `Boards ${exp.boards}/${exp.neededBoards}  Stones ${exp.stones}/${exp.neededStones}  Builder ${builder}`,
      }),
    );

    if (exp.ready) {
      const idle = session.hasIdleShipAt(this.harborId);
      if (idle) {
        wrap.append(
          this.button(
            'Start expedition',
            () => {
              this.deps.beginExpeditionTarget(this.harborId);
              this.close();
            },
            'start-expedition',
          ),
        );
      } else {
        wrap.append(
          el('div', {
            class: 'mil-rank mil-empty',
            text: 'Waiting for an idle ship',
            attrs: { 'data-testid': 'expedition-no-ship' },
          }),
        );
      }
    }
    return wrap;
  }
}
