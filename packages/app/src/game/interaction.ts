/**
 * Click interaction for the game page: a node context menu (place flag / build
 * building / demolish, gated by the engine's buildability helpers) and a road
 * mode that auto-paths from a selected flag to a destination flag using the
 * engine's lattice pathfinding.
 */

import {
  BUILD_COST,
  BUILDING_DEFS,
  buildingAt,
  requiresCoast,
  type BuildingSize,
  type BuildingType,
} from '@s2gold/engine';
import type { Camera } from '@s2gold/renderer';
import { el } from '../lib/dom';
import { nodeAtWorld } from './game-render';
import type { GameSession } from './session';

/**
 * The original groups buildings by the size class of the site they need. We
 * mirror that here: each category lists every currently-buildable building of
 * that size (gated by the engine's canPlaceBuilding, so mines only appear on
 * mountains, larger buildings only where the site fits), with its board/stone
 * cost. The full building set is read from the engine's BUILDING_DEFS table so
 * new economy buildings appear automatically.
 */
const BUILD_CATEGORIES: { size: BuildingSize; label: string }[] = [
  { size: 'hut', label: 'Huts' },
  { size: 'house', label: 'Houses' },
  { size: 'castle', label: 'Castles' },
  { size: 'mine', label: 'Mines' },
];

/**
 * Coastal buildings (harbor + shipyard) get their own build-menu category: the
 * engine gates them on {@link requiresCoast} (buildable shore land touching
 * navigable water), so they only appear when the clicked node is a valid coast
 * — canPlaceHarbor for the harbor, canPlaceBuilding for the shipyard, both via
 * session.canBuild. Read from BUILDING_DEFS so the list stays data-driven; the
 * harbor is listed first (the bigger, territory-anchoring building).
 */
const COASTAL_TYPES: BuildingType[] = Object.keys(BUILDING_DEFS)
  .filter((t) => t !== 'headquarters' && requiresCoast(t))
  .sort((a, b) => (a === 'harbor' ? -1 : b === 'harbor' ? 1 : a.localeCompare(b)));

/** Human-readable menu label per building type (falls back to a title-cased id). */
const BUILDING_LABEL: Readonly<Record<string, string>> = {
  woodcutter: 'Woodcutter',
  forester: 'Forester',
  quarry: 'Quarry',
  fishery: 'Fishery',
  well: 'Well',
  hunter: 'Hunter',
  lookout: 'Lookout tower',
  sawmill: 'Sawmill',
  mill: 'Mill',
  bakery: 'Bakery',
  slaughterhouse: 'Slaughterhouse',
  brewery: 'Brewery',
  ironsmelter: 'Iron smelter',
  armory: 'Armory',
  metalworks: 'Metalworks',
  mint: 'Mint',
  storehouse: 'Storehouse',
  harbor: 'Harbor',
  shipyard: 'Shipyard',
  farm: 'Farm',
  pigfarm: 'Pig farm',
  donkeybreeder: 'Donkey breeder',
  coalmine: 'Coal mine',
  ironmine: 'Iron mine',
  goldmine: 'Gold mine',
  granitemine: 'Granite mine',
};

/** Building types in menu order, grouped by size class (excluding the HQ). */
const BUILDINGS_BY_SIZE: Readonly<Record<BuildingSize, BuildingType[]>> = (() => {
  const groups: Record<BuildingSize, BuildingType[]> = {
    hut: [],
    house: [],
    castle: [],
    mine: [],
    // Harbors are a warehouse-class engine building not offered in the node
    // build menu (see BUILD_CATEGORIES); the group exists only to satisfy the
    // size map and is intentionally left unrendered.
    harbor: [],
  };
  for (const [type, def] of Object.entries(BUILDING_DEFS)) {
    if (type === 'headquarters') continue; // the HQ is a scenario start, never built
    if (requiresCoast(type)) continue; // harbor/shipyard live in the Coastal category
    const group = groups[def.size];
    if (!group) continue; // unknown/future size class: skip defensively
    group.push(type);
  }
  return groups;
})();

/** Board/stone cost rendered compactly, e.g. "2b 2s" or "4b". */
function costText(type: BuildingType): string {
  const cost = BUILD_COST[type];
  return `${cost.boards}b${cost.stones > 0 ? ` ${cost.stones}s` : ''}`;
}

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
  /**
   * Try to open the military building panel at a node. Returns true when a
   * military building was there (so the build menu is suppressed).
   */
  openMilitary?(node: number, clientX: number, clientY: number): boolean;
  /** Close any open military panel (e.g. a click landed elsewhere). */
  closeMilitary?(): void;
  /**
   * Try to open the harbor panel at a node. Returns true when an own working
   * harbor was there (so the build menu is suppressed).
   */
  openHarbor?(node: number, clientX: number, clientY: number): boolean;
  /** Close any open harbor panel. */
  closeHarbor?(): void;
}

/** Live road-build preview: the hovered destination and the path to it. */
export interface RoadPreview {
  /** Hovered destination node (-1 before the cursor moves). */
  readonly node: number;
  /** Node path from the origin flag to `node`, or null when none is valid. */
  readonly path: number[] | null;
  /** True when a road can actually be built to `node` (path + placeable end). */
  readonly valid: boolean;
}

export class Interaction {
  private menu: HTMLElement | null = null;
  private roadStartFlagNode = -1;
  /** Harbor id awaiting an expedition target click (-1 = not selecting). */
  private expeditionHarborId = -1;

  // Road-build preview state (recomputed only when the hovered node changes;
  // hover picking is coalesced to one animation frame to bound the node scan).
  private hoverNode = -1;
  private previewPath: number[] | null = null;
  private previewValid = false;
  private pendingMove: { x: number; y: number } | null = null;
  private hoverRafScheduled = false;
  /** Bumped by cancel(); aborts any pending auto-road-mode poll. */
  private cancelGeneration = 0;

  constructor(private readonly deps: InteractionDeps) {
    const { canvas } = deps;
    canvas.addEventListener('click', (ev) => this.onClick(ev));
    canvas.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      this.cancel();
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (!this.roadMode) return;
      this.pendingMove = { x: ev.clientX, y: ev.clientY };
      this.scheduleHoverUpdate();
    });
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') this.cancel();
    });
  }

  /** True while awaiting a road destination click. */
  get roadMode(): boolean {
    return this.roadStartFlagNode >= 0;
  }

  /** Current road-build preview, or null when not in road mode. */
  get roadPreview(): RoadPreview | null {
    if (!this.roadMode) return null;
    return { node: this.hoverNode, path: this.previewPath, valid: this.previewValid };
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
    // Expedition target-select mode: the next map click is the landing spot.
    if (this.expeditionMode) {
      this.finishExpedition(node);
      return;
    }
    this.deps.closeMilitary?.();
    this.deps.closeHarbor?.();
    if (this.roadMode) {
      this.finishRoad(node);
      return;
    }
    // A military building (own or enemy) opens its garrison/attack panel first;
    // an own harbor opens its expedition panel; otherwise the build menu.
    if (this.deps.openMilitary?.(node, ev.clientX, ev.clientY)) return;
    if (this.deps.openHarbor?.(node, ev.clientX, ev.clientY)) return;
    this.openMenu(ev.clientX, ev.clientY, node);
  }

  // --- Expedition target-select mode ---------------------------------------

  /** True while awaiting a click that picks an expedition's landing spot. */
  get expeditionMode(): boolean {
    return this.expeditionHarborId >= 0;
  }

  /** Enter target-select mode: the next map click launches from `harborId`. */
  startExpeditionSelect(harborId: number): void {
    this.roadStartFlagNode = -1;
    this.clearPreview();
    this.expeditionHarborId = harborId;
    this.deps.onStatus('Expedition: click a coastal spot on another shore (Esc to cancel)');
  }

  private finishExpedition(node: number): void {
    const harborId = this.expeditionHarborId;
    this.expeditionHarborId = -1;
    this.deps.onStatus('');
    if (harborId < 0) return;
    // The engine validates the target (free coastal land with a water route from
    // the harbor dock); an invalid spot is simply a no-op.
    this.deps.session().startExpedition(harborId, node);
  }

  // --- Road mode ------------------------------------------------------------

  private startRoad(fromFlagNode: number): void {
    this.roadStartFlagNode = fromFlagNode;
    this.clearPreview();
    this.deps.onStatus('Road mode: click a destination flag or free node (Esc to cancel)');
  }

  private finishRoad(destNode: number): void {
    const session = this.deps.session();
    const start = this.roadStartFlagNode;
    this.roadStartFlagNode = -1;
    this.clearPreview();
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
      // Grouped build menu: one section per size class, listing every building
      // of that size the engine says can be placed here, with its cost.
      const addBuildable = (label: string, types: readonly BuildingType[]): void => {
        const buildable = types.filter((t) => session.canBuild(node, t));
        if (buildable.length === 0) return;
        items.push(this.categoryLabel(label));
        for (const type of buildable) {
          const name = BUILDING_LABEL[type] ?? titleCase(type);
          items.push(
            this.action(
              `${name} (${costText(type)})`,
              () => {
                session.placeBuilding(node, type);
                // Like the original: drop straight into road mode from the new
                // site's flag so the player connects it to the network. The
                // command is queued, so poll a few frames for the flag to land;
                // Escape/right-click (cancel) aborts the pending poll.
                const flagNode = session.geom.neighbour(node, 'SE');
                const generation = this.cancelGeneration;
                const tryStart = (attempts: number): void => {
                  if (this.cancelGeneration !== generation) return;
                  const s = this.deps.session();
                  if (s.flagIdAt(flagNode) >= 0) {
                    if (!this.roadMode && !this.menu) this.startRoad(flagNode);
                    return;
                  }
                  if (attempts > 0) requestAnimationFrame(() => tryStart(attempts - 1));
                };
                tryStart(120);
              },
              `ctx-${type}`,
            ),
          );
        }
      };
      for (const cat of BUILD_CATEGORIES) addBuildable(cat.label, BUILDINGS_BY_SIZE[cat.size]);
      // Coastal buildings (harbor + shipyard) only when the shore admits them.
      addBuildable('Coastal', COASTAL_TYPES);
    }

    if (items.length === 0) items.push(this.label('Nothing to do here'));

    const menu = el(
      'div',
      { class: 'ctx-menu ctx-menu-build', attrs: { 'data-testid': 'ctx-menu' } },
      ...items,
    );
    menu.style.left = `${clientX + 2}px`;
    menu.style.top = `${clientY + 2}px`;
    this.deps.root.append(menu);
    this.menu = menu;
  }

  private action(text: string, run: () => void, testid?: string): HTMLElement {
    const btn = el('button', {
      text,
      attrs: { type: 'button', 'data-testid': testid ?? `ctx-${slug(text)}` },
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

  /** A size-class section header inside the build menu. */
  private categoryLabel(text: string): HTMLElement {
    return el('div', { class: 'ctx-label ctx-category', text });
  }

  private closeMenu(): void {
    if (this.menu) {
      this.menu.remove();
      this.menu = null;
    }
  }

  private cancel(): void {
    this.cancelGeneration++;
    this.closeMenu();
    if (this.roadMode) {
      this.roadStartFlagNode = -1;
      this.clearPreview();
      this.deps.onStatus('');
    }
    if (this.expeditionMode) {
      this.expeditionHarborId = -1;
      this.deps.onStatus('');
    }
  }

  // --- Road preview ---------------------------------------------------------

  /** Coalesce rapid pointer moves into a single per-frame hover recompute. */
  private scheduleHoverUpdate(): void {
    if (this.hoverRafScheduled) return;
    this.hoverRafScheduled = true;
    requestAnimationFrame(() => {
      this.hoverRafScheduled = false;
      this.updateHover();
    });
  }

  private updateHover(): void {
    if (!this.roadMode || !this.pendingMove) return;
    const node = this.screenToNode(this.pendingMove.x, this.pendingMove.y);
    if (node === this.hoverNode) return; // only recompute when the node changes
    this.hoverNode = node;
    this.recomputePreview();
  }

  /** Recompute the previewed path + validity for the current hovered node. */
  private recomputePreview(): void {
    const start = this.roadStartFlagNode;
    const node = this.hoverNode;
    if (node < 0 || node === start) {
      this.previewPath = null;
      this.previewValid = false;
      return;
    }
    const session = this.deps.session();
    const path = session.suggestRoad(start, node);
    // Valid only when a path exists and the far end is (or can become) a flag —
    // the same gate finishRoad applies before committing the road.
    const endOk = path !== null && (session.flagIdAt(node) >= 0 || session.canFlag(node));
    if (path && endOk) {
      this.previewPath = path;
      this.previewValid = true;
    } else {
      this.previewPath = null; // invalid: marker only, no segments
      this.previewValid = false;
    }
  }

  private clearPreview(): void {
    this.hoverNode = -1;
    this.pendingMove = null;
    this.previewPath = null;
    this.previewValid = false;
  }
}

/** Slugify a menu label for a stable test id (first word, lowercased). */
function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '').split('-')[0] ?? 'item';
}

/** Title-case a building id as a last-resort label (e.g. "pigfarm" -> "Pigfarm"). */
function titleCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
