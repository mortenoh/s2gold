/**
 * Goods window: the local player's full inventory, mirroring the original
 * Settlers II goods statistics. A HUD "Goods" button opens a panel listing every
 * ware type grouped by role (raw materials, food & drink, tools, weapons) with
 * live counts, so it is easy to see what you have and what you lack — the HUD bar
 * itself only tracks the three build materials.
 *
 * Ware naming follows the original UI (Wood, Boards, ...) even though the engine
 * keeps its internal keys (trunk, plank, ...).
 *
 * Liveness: the grid DOM is built once on open; {@link GoodsPanel.update} is
 * called from the game's per-frame loop (like the HUD resources readout) and
 * patches the count cells in place, so the figures track the running economy
 * without reopening the panel.
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

/** One resolved ware row (engine key, display label, current count). */
export interface GoodsEntry {
  readonly key: string;
  readonly label: string;
  readonly count: number;
}

/**
 * Flatten the grouped ware table to per-ware counts from a goods snapshot.
 * Pure and DOM-free so the panel's live-update logic is unit-testable in a
 * non-DOM environment (vitest runs in the node env here).
 */
export function goodsEntries(goods: Record<string, number>): GoodsEntry[] {
  const out: GoodsEntry[] = [];
  for (const group of GROUPS) {
    for (const [key, label] of group.wares) out.push({ key, label, count: goods[key] ?? 0 });
  }
  return out;
}

export interface GoodsPanelDeps {
  readonly root: HTMLElement;
  session(): GameSession | null;
  /** Notified on open/close so the HUD bar button can reflect the state. */
  onVisibility?(open: boolean): void;
}

export class GoodsPanel {
  private panel: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  /** Live count-cell references per ware key, for in-place per-frame updates. */
  private readonly cells = new Map<string, { row: HTMLElement; count: HTMLElement }>();
  private title = 'Goods';

  constructor(private readonly deps: GoodsPanelDeps) {}

  get isOpen(): boolean {
    return this.panel !== null;
  }

  /** The live panel element (null while closed). */
  get element(): HTMLElement | null {
    return this.panel;
  }

  close(): void {
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
    }
    this.body = null;
    this.cells.clear();
    this.deps.onVisibility?.(false);
  }

  open(title = 'Goods'): void {
    if (!this.deps.session()) return;
    this.close();
    this.title = title;
    const closeButton = el('button', {
      text: '✕',
      attrs: { type: 'button', 'data-testid': 'goods-close', title: 'Close' },
    });
    closeButton.addEventListener('click', () => this.close());

    this.body = el('div', { class: 'goods-body' });
    const head = el(
      'div',
      { class: 'goods-panel-head' },
      el('span', { class: 'goods-panel-title', text: this.title }),
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
    this.build();
    this.update();
    this.deps.onVisibility?.(true);
  }

  /** Build the grouped grid once, caching each ware's count cell for updates. */
  private build(): void {
    if (!this.body) return;
    clear(this.body);
    this.cells.clear();
    for (const group of GROUPS) {
      const rows = group.wares.map(([key, label]) => {
        const count = el('span', {
          class: 'goods-count',
          attrs: { 'data-testid': `goods-${key}` },
        });
        const row = el(
          'div',
          { class: 'goods-row', attrs: { title: label } },
          el('span', { class: 'goods-name', text: label }),
          count,
        );
        this.cells.set(key, { row, count });
        return row;
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

  /**
   * Refresh the count cells from live session state. Called from the game's
   * per-frame loop while open (a no-op when closed); patches only the changed
   * text/zero-class so it is cheap enough to run every frame.
   */
  update(): void {
    const session = this.deps.session();
    if (!this.body || !session) return;
    const goods = session.goods;
    for (const { key, count } of goodsEntries(goods)) {
      const cell = this.cells.get(key);
      if (!cell) continue;
      const text = String(count);
      if (cell.count.textContent !== text) cell.count.textContent = text;
      cell.row.classList.toggle('goods-zero', count === 0);
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
      const left = Math.max(
        margin,
        Math.min(e.clientX - dx, window.innerWidth - rect.width - margin),
      );
      const top = Math.max(
        margin,
        Math.min(e.clientY - dy, window.innerHeight - rect.height - margin),
      );
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
