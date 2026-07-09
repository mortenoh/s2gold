/**
 * Click interaction for the game page: a node context menu (place flag / build
 * building / demolish, gated by the engine's buildability helpers) and a road
 * mode that auto-paths from a selected flag to a destination flag using the
 * engine's lattice pathfinding.
 */

import { BUILD_COST, buildingAt, type BuildingType } from '@s2gold/engine';
import type { Camera } from '@s2gold/renderer';
import { el } from '../lib/dom';
import { nodeAtWorld } from './game-render';
import type { GameSession } from './session';

/** Buildings offered in the P2 build menu, in menu order. */
const MENU_BUILDINGS: { type: BuildingType; label: string }[] = [
  { type: 'woodcutter', label: 'Woodcutter' },
  { type: 'forester', label: 'Forester' },
  { type: 'sawmill', label: 'Sawmill' },
  { type: 'quarry', label: 'Quarry' },
];

/** Dependencies the interaction layer reads live (they change on map switch). */
export interface InteractionDeps {
  readonly canvas: HTMLCanvasElement;
  readonly root: HTMLElement;
  session(): GameSession;
  camera(): Camera;
  /** Called whenever road mode toggles, for HUD status text. */
  onStatus(text: string): void;
  /** True when the pending click ended a drag and should not open a menu. */
  suppressClick?(): boolean;
}

export class Interaction {
  private menu: HTMLElement | null = null;
  private roadStartFlagNode = -1;

  constructor(private readonly deps: InteractionDeps) {
    const { canvas } = deps;
    canvas.addEventListener('click', (ev) => this.onClick(ev));
    canvas.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      this.cancel();
    });
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') this.cancel();
    });
  }

  /** True while awaiting a road destination click. */
  get roadMode(): boolean {
    return this.roadStartFlagNode >= 0;
  }

  /** Lattice node under a client-space point (elevation + wrap aware). */
  screenToNode(clientX: number, clientY: number): number {
    const { canvas } = this.deps;
    const camera = this.deps.camera();
    const session = this.deps.session();
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const sx = (clientX - rect.left) * dpr;
    const sy = (clientY - rect.top) * dpr;
    const { w: worldW, h: worldH } = camera.worldSize;
    const worldX = camera.x + sx / camera.zoom;
    const worldY = camera.y + sy / camera.zoom;
    return nodeAtWorld(session.world, worldX, worldY, worldW, worldH);
  }

  private onClick(ev: MouseEvent): void {
    this.closeMenu();
    if (this.deps.suppressClick?.()) return;
    const node = this.screenToNode(ev.clientX, ev.clientY);
    if (node < 0) return;
    if (this.roadMode) {
      this.finishRoad(node);
      return;
    }
    this.openMenu(ev.clientX, ev.clientY, node);
  }

  // --- Road mode ------------------------------------------------------------

  private startRoad(fromFlagNode: number): void {
    this.roadStartFlagNode = fromFlagNode;
    this.deps.onStatus('Road mode: click a destination flag or free node (Esc to cancel)');
  }

  private finishRoad(destNode: number): void {
    const session = this.deps.session();
    const start = this.roadStartFlagNode;
    this.roadStartFlagNode = -1;
    this.deps.onStatus('');
    if (destNode === start) return;

    const destFlag = session.flagIdAt(destNode);
    const path = session.suggestRoad(start, destNode);
    if (!path) return;
    if (destFlag < 0) {
      if (!session.canFlag(destNode)) return;
      session.placeFlag(destNode);
    }
    session.buildRoad(path);
  }

  // --- Context menu ---------------------------------------------------------

  private openMenu(clientX: number, clientY: number, node: number): void {
    const session = this.deps.session();
    const items: HTMLElement[] = [];

    const building = buildingAt(session.world, node);
    const flagId = session.flagIdAt(node);

    if (building && building.player === 0) {
      if (building.type !== 'headquarters') {
        items.push(this.action('Demolish', () => session.demolish(node)));
      } else {
        items.push(this.label('Headquarters'));
      }
    } else if (flagId >= 0) {
      items.push(this.action('Build road', () => this.startRoad(node)));
      items.push(this.action('Demolish flag', () => session.demolish(node)));
    } else {
      if (session.canFlag(node)) {
        items.push(this.action('Flag', () => session.placeFlag(node)));
      }
      for (const b of MENU_BUILDINGS) {
        if (!session.canBuild(node, b.type)) continue;
        const cost = BUILD_COST[b.type];
        const costText = `${cost.boards}b${cost.stones > 0 ? ` ${cost.stones}s` : ''}`;
        items.push(
          this.action(`${b.label} (${costText})`, () => session.placeBuilding(node, b.type)),
        );
      }
    }

    if (items.length === 0) items.push(this.label('Nothing to do here'));

    const menu = el('div', { class: 'ctx-menu', attrs: { 'data-testid': 'ctx-menu' } }, ...items);
    menu.style.left = `${clientX + 2}px`;
    menu.style.top = `${clientY + 2}px`;
    this.deps.root.append(menu);
    this.menu = menu;
  }

  private action(text: string, run: () => void): HTMLElement {
    const btn = el('button', {
      text,
      attrs: { type: 'button', 'data-testid': `ctx-${slug(text)}` },
    });
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      run();
      this.closeMenu();
    });
    return btn;
  }

  private label(text: string): HTMLElement {
    return el('div', { class: 'ctx-label', text });
  }

  private closeMenu(): void {
    if (this.menu) {
      this.menu.remove();
      this.menu = null;
    }
  }

  private cancel(): void {
    this.closeMenu();
    if (this.roadMode) {
      this.roadStartFlagNode = -1;
      this.deps.onStatus('');
    }
  }
}

/** Slugify a menu label for a stable test id (first word, lowercased). */
function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '').split('-')[0] ?? 'item';
}
