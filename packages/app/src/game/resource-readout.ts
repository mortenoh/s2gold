/**
 * The HUD's at-a-glance build-material readout (Wood / Boards / Stone). With
 * the original ware pictographs available it renders icon+count cells; without
 * them it falls back to a fixed-width text line so the bar never reflows.
 * Names follow the original S2 UI: Wood (raw log), Boards (sawn), Stone.
 */

import { clear, el } from '../lib/dom';
import type { WareIconSet } from './ware-icons';

/** The three HUD wares, in display order, with their tooltip labels. */
const CELLS = [
  ['trunk', 'Wood'],
  ['plank', 'Boards'],
  ['stone', 'Stone'],
] as const;

type CellKey = (typeof CELLS)[number][0];

/** Right-align a count into a fixed 4-char cell so the bar never reflows. */
const pad4 = (n: number): string => String(Math.min(n, 9999)).padStart(4, ' ');

export class ResourceReadout {
  readonly element: HTMLElement;
  /** Live count cells when the pictographs are available (null = text mode). */
  private cells: Record<CellKey, HTMLElement> | null = null;

  constructor() {
    this.element = el('span', { class: 'resources', attrs: { 'data-testid': 'resources' } });
  }

  /**
   * Rebuild as pictograph+count cells from a ware icon set, or fall back to the
   * plain text readout (icons null / a sprite missing). Called on every map
   * switch since the icons live in the current landscape's object atlas.
   */
  build(icons: WareIconSet | null): void {
    clear(this.element);
    this.cells = null;
    if (!icons) return;
    const cells = {} as Record<CellKey, HTMLElement>;
    for (const [ware, label] of CELLS) {
      const icon = el('span', { class: 'resource-icon' });
      if (!icons.apply(icon, ware)) {
        clear(this.element);
        this.cells = null;
        return; // one missing sprite: keep the readable text readout
      }
      const count = el('span', {
        class: 'resource-count',
        attrs: { 'data-testid': `resource-${ware}` },
      });
      cells[ware] = count;
      this.element.append(
        el(
          'span',
          { class: 'resource-cell', attrs: { title: label } },
          // Fixed-size box centring the native-size sprite, so the three cells
          // share one vertical axis regardless of each pictograph's height.
          el('span', { class: 'resource-icon-box' }, icon),
          count,
        ),
      );
    }
    this.cells = cells;
  }

  /** Update the counts from the local player's inventory totals. */
  update(inv: { trunk: number; plank: number; stone: number }): void {
    if (this.cells) {
      // No space-padding here: the cells right-align into a fixed min-width via
      // CSS, so the bar never reflows and the digits sit tight to their icon.
      this.cells.trunk.textContent = String(Math.min(inv.trunk, 9999));
      this.cells.plank.textContent = String(Math.min(inv.plank, 9999));
      this.cells.stone.textContent = String(Math.min(inv.stone, 9999));
    } else {
      this.element.textContent = `Wood${pad4(inv.trunk)} Boards${pad4(inv.plank)} Stone${pad4(inv.stone)}`;
    }
  }
}
