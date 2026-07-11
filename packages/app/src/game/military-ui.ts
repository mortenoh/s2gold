/**
 * Military building panel: opens when the player clicks a military building.
 *
 * - Own building: shows the garrison broken down by rank, the coin count, and a
 *   toggle for gold-coin delivery (drives the engine `toggleCoins` command).
 * - Enemy building within attack reach: shows a soldier-count selector and an
 *   Attack button (drives the engine `attack` command, MILITARY.md §4).
 *
 * The panel polls the live engine snapshot while open so the garrison/coins and
 * an in-flight attack's aftermath (capture, losses) stay current.
 */

import { SOLDIER_RANK_NAMES, type MilitaryView } from '@s2gold/engine';
import { clear, el } from '../lib/dom';
import type { GameSession } from './session';

/** Prettified rank labels indexed by rank 0..4. */
const RANK_LABEL: readonly string[] = SOLDIER_RANK_NAMES.map((n) =>
  n
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' '),
);

/** Dependencies the panel reads live (they change on map switch). */
export interface MilitaryPanelDeps {
  readonly root: HTMLElement;
  session(): GameSession;
}

export class MilitaryPanel {
  private panel: HTMLElement | null = null;
  private node = -1;
  private buildingId = -1;
  private refreshTimer = 0;

  constructor(private readonly deps: MilitaryPanelDeps) {
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') this.close();
    });
  }

  /** True when the panel is open. */
  get isOpen(): boolean {
    return this.panel !== null;
  }

  /**
   * Try to open the panel for the building at `node`. Returns true when a
   * military building was found there (own, or an enemy — even out of reach, so
   * the player sees why they cannot attack). Returns false otherwise, so the
   * caller can fall back to the normal build context menu.
   */
  openAt(node: number, clientX: number, clientY: number): boolean {
    const session = this.deps.session();
    const view = session.militaryAt(node);
    if (!view) return false;
    this.close();
    this.node = node;
    this.buildingId = view.buildingId;
    const panel = el('div', {
      class: 'military-panel',
      attrs: { 'data-testid': 'military-panel' },
    });
    panel.style.left = `${clientX + 4}px`;
    panel.style.top = `${clientY + 4}px`;
    this.panel = panel;
    this.deps.root.append(panel);
    this.render();
    // Live refresh while open (garrison fills, coins arrive, attack resolves).
    this.refreshTimer = window.setInterval(() => this.render(), 400);
    return true;
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
    this.node = -1;
    this.buildingId = -1;
  }

  private render(): void {
    const panel = this.panel;
    if (!panel) return;
    const session = this.deps.session();
    const view = session.militaryAt(this.node);
    if (!view || view.buildingId !== this.buildingId) {
      // The building was captured/razed while open: reflect it and stop.
      clear(panel);
      panel.append(el('div', { class: 'mil-title', text: 'Building lost' }));
      return;
    }
    clear(panel);
    const own = view.player === session.localPlayer;
    panel.append(this.header(view, own));
    panel.append(this.garrisonList(view));
    if (own) panel.append(this.coinRow(view));
    else panel.append(this.attackRow(view));
    panel.append(
      el(
        'div',
        { class: 'mil-actions' },
        this.button('Close', () => this.close(), 'military-close'),
      ),
    );
  }

  private header(view: MilitaryView, own: boolean): HTMLElement {
    const name = view.type.charAt(0).toUpperCase() + view.type.slice(1);
    const who = own ? 'Yours' : `Player ${view.player + 1}`;
    return el(
      'div',
      { class: 'mil-title', attrs: { 'data-testid': 'military-title' } },
      el('span', { text: name }),
      el('span', { class: 'mil-owner', text: who }),
    );
  }

  private garrisonList(view: MilitaryView): HTMLElement {
    const rows: HTMLElement[] = [];
    for (let r = view.garrison.length - 1; r >= 0; r--) {
      const n = view.garrison[r] ?? 0;
      if (n <= 0) continue;
      rows.push(
        el('div', {
          class: 'mil-rank',
          text: `${RANK_LABEL[r] ?? `Rank ${r}`} x${n}`,
          attrs: { 'data-testid': `garrison-rank-${r}` },
        }),
      );
    }
    if (rows.length === 0) {
      rows.push(
        el('div', { class: 'mil-rank mil-empty', text: view.occupied ? 'Empty' : 'Unoccupied' }),
      );
    }
    return el(
      'div',
      { class: 'mil-garrison', attrs: { 'data-testid': 'garrison-list' } },
      el('div', { class: 'mil-sub', text: `Garrison ${view.troops}/${view.maxTroops}` }),
      ...rows,
    );
  }

  private coinRow(view: MilitaryView): HTMLElement {
    const label = `Coins ${view.coins}/${view.maxGold} — ${view.coinsEnabled ? 'on' : 'off'}`;
    return el(
      'div',
      { class: 'mil-coins' },
      el('span', { text: label, attrs: { 'data-testid': 'coin-status' } }),
      this.button(
        view.coinsEnabled ? 'Stop coins' : 'Send coins',
        () => {
          this.deps.session().toggleCoins(view.buildingId, !view.coinsEnabled);
          this.render();
        },
        'coin-toggle',
      ),
    );
  }

  private attackRow(view: MilitaryView): HTMLElement {
    const session = this.deps.session();
    const max = session.attackableSoldiers(view.buildingId);
    if (max <= 0) {
      return el('div', {
        class: 'mil-attack mil-empty',
        text: 'Out of reach',
        attrs: { 'data-testid': 'attack-unreachable' },
      });
    }
    const count = el('input', {
      attrs: {
        'data-testid': 'attack-count',
        type: 'number',
        min: '1',
        max: String(max),
        value: String(max),
      },
    });
    return el(
      'div',
      { class: 'mil-attack' },
      el('div', { class: 'mil-sub', text: `Attack (up to ${max})` }),
      el(
        'div',
        { class: 'mil-attack-row' },
        count,
        this.button(
          'Attack',
          () => {
            // An empty or zero count clamps to 1; it must never mean "send all".
            const raw = Number(count.value);
            const n = Math.max(1, Math.min(max, Number.isFinite(raw) ? raw : 1));
            session.attack(view.buildingId, n);
            this.render();
          },
          'attack-submit',
        ),
      ),
    );
  }

  private button(text: string, run: () => void, testid: string): HTMLElement {
    const btn = el('button', { text, attrs: { type: 'button', 'data-testid': testid } });
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      run();
    });
    return btn;
  }
}
