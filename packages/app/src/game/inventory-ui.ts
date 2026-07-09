/**
 * Goods window: the local player's full inventory, mirroring the original
 * Settlers II goods statistics. A HUD "Goods" button opens a panel listing every
 * ware type grouped by role (raw materials, food & drink, tools, weapons) with
 * live counts, so it is easy to see what you have and what you lack — the HUD bar
 * itself only tracks the three build materials.
 *
 * Ware naming follows the original UI (Wood, Boards, ...) even though the engine
 * keeps its internal keys (trunk, plank, ...).
 */

import { clear, el } from '../lib/dom';
import type { GameSession } from './session';

/** Display name per engine ware key, grouped for the panel. */
interface GoodsGroup {
  readonly title: string;
  readonly wares: readonly (readonly [key: string, label: string])[];
}

const GROUPS: readonly GoodsGroup[] = [
  {
    title: 'Raw materials',
    wares: [
      ['trunk', 'Wood'],
      ['plank', 'Boards'],
      ['stone', 'Stone'],
      ['coal', 'Coal'],
      ['ironore', 'Iron ore'],
      ['iron', 'Iron'],
      ['gold', 'Gold'],
      ['coins', 'Coins'],
    ],
  },
  {
    title: 'Food & drink',
    wares: [
      ['grain', 'Grain'],
      ['flour', 'Flour'],
      ['bread', 'Bread'],
      ['fish', 'Fish'],
      ['meat', 'Meat'],
      ['ham', 'Ham'],
      ['water', 'Water'],
      ['beer', 'Beer'],
    ],
  },
  {
    title: 'Weapons',
    wares: [
      ['sword', 'Sword'],
      ['shield', 'Shield'],
      ['bow', 'Bow'],
    ],
  },
  {
    title: 'Tools',
    wares: [
      ['hammer', 'Hammer'],
      ['axe', 'Axe'],
      ['saw', 'Saw'],
      ['pickaxe', 'Pick axe'],
      ['shovel', 'Shovel'],
      ['crucible', 'Crucible'],
      ['rodandline', 'Rod & line'],
      ['scythe', 'Scythe'],
      ['cleaver', 'Cleaver'],
      ['rollingpin', 'Rolling pin'],
      ['tongs', 'Tongs'],
    ],
  },
];

export interface GoodsPanelDeps {
  readonly root: HTMLElement;
  session(): GameSession | null;
}

export class GoodsPanel {
  private panel: HTMLElement | null = null;
  private refreshTimer = 0;
  private body: HTMLElement | null = null;

  constructor(private readonly deps: GoodsPanelDeps) {
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') this.close();
    });
  }

  get isOpen(): boolean {
    return this.panel !== null;
  }

  toggle(): void {
    if (this.panel) this.close();
    else this.open();
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
    this.body = null;
  }

  private open(): void {
    if (!this.deps.session()) return;
    this.close();
    const closeButton = el('button', {
      text: '✕',
      attrs: { type: 'button', 'data-testid': 'goods-close', title: 'Close' },
    });
    closeButton.addEventListener('click', () => this.close());

    this.body = el('div', { class: 'goods-body' });
    const head = el(
      'div',
      { class: 'goods-panel-head' },
      el('span', { class: 'goods-panel-title', text: 'Goods' }),
      closeButton,
    );
    this.panel = el(
      'div',
      { class: 'goods-panel', attrs: { 'data-testid': 'goods-panel' } },
      head,
      this.body,
    );
    this.deps.root.append(this.panel);
    makeDraggable(this.panel, head, closeButton);
    this.render();
    this.refreshTimer = window.setInterval(() => this.render(), 500);
  }

  private render(): void {
    const session = this.deps.session();
    if (!this.body || !session) return;
    const wares = session.goods;
    clear(this.body);
    for (const group of GROUPS) {
      const rows = group.wares.map(([key, label]) => {
        const count = wares[key] ?? 0;
        return el(
          'div',
          { class: `goods-row${count === 0 ? ' goods-zero' : ''}` },
          el('span', { class: 'goods-name', text: label }),
          el('span', {
            class: 'goods-count',
            text: String(count),
            attrs: { 'data-testid': `goods-${key}` },
          }),
        );
      });
      this.body.append(
        el(
          'div',
          { class: 'goods-group' },
          el('div', { class: 'goods-group-title', text: group.title }),
          el('div', { class: 'goods-grid' }, ...rows),
        ),
      );
    }
  }
}

/**
 * Let the user drag `panel` by its `handle`. On first drag the panel switches to
 * absolute left/top pixels (dropping any centering transform) and is clamped to
 * the viewport. Dragging is ignored when it starts on `ignore` (the close button).
 */
function makeDraggable(panel: HTMLElement, handle: HTMLElement, ignore: HTMLElement): void {
  handle.style.cursor = 'move';
  handle.addEventListener('pointerdown', (ev) => {
    if (ignore.contains(ev.target as Node)) return;
    ev.preventDefault();
    const rect = panel.getBoundingClientRect();
    const dx = ev.clientX - rect.left;
    const dy = ev.clientY - rect.top;
    panel.style.transform = 'none';
    const move = (e: PointerEvent): void => {
      const margin = 4;
      const left = Math.max(margin, Math.min(e.clientX - dx, window.innerWidth - rect.width - margin));
      const top = Math.max(margin, Math.min(e.clientY - dy, window.innerHeight - rect.height - margin));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}
