/**
 * Game session: wraps the deterministic engine world in a fixed-tick loop and a
 * thin command/query surface for the UI. Rendering stays per-frame and reads
 * live state; this only advances the sim and tallies one-shot events.
 *
 * One game frame (GF) = 50 ms at 1x. Speed multiplies the tick rate; rendering
 * interpolates between ticks via the returned alpha.
 */

import {
  applyCommand,
  borderNodes,
  buildingAt,
  buildingDef,
  canPlaceBuilding,
  canPlaceFlag,
  createWorld,
  deserializeWorld,
  findWalkPath,
  flagAt,
  GREENLAND_RULES,
  militaryView,
  MILITARY_ATTACK,
  NUM_SOLDIER_RANKS,
  ownerAt,
  serializeWorld,
  territoryOf,
  tickWorld,
  visibleNodes,
  worldGeometry,
  type Building,
  type BuildingType,
  type Flag,
  type Geometry,
  type MapJson,
  type MilitaryView,
  type World,
} from '@s2gold/engine';
import { soundForEvent, type SoundCue } from './audio-map';

/** Per-node fog state used by the renderer (see TerrainRenderer.setFog). */
export const FOG = { unexplored: 0, explored: 1, visible: 2 } as const;

/** Allocate a slot in an engine store (mirrors the engine's internal helper). */
function storeAllocLocal<T>(
  store: { items: (T | null)[]; free: number[] },
  make: (id: number) => T,
): number {
  const id = store.free.length > 0 ? (store.free.pop() as number) : store.items.length;
  store.items[id] = make(id);
  return id;
}

/** Milliseconds per game frame at 1x speed. */
const GF_MS = 50;
/** Cap catch-up steps per update so a stall cannot freeze the tab. */
const MAX_STEPS_PER_UPDATE = 240;

/** Debug/event counters exposed for tests and the HUD. */
export interface GameCounters {
  treesFelled: number;
  treesPlanted: number;
  stonesMined: number;
  trunksProduced: number;
  planksProduced: number;
  stonesProduced: number;
  waresDelivered: number;
  buildingsPlaced: number;
  buildingsCompleted: number;
  flagsPlaced: number;
  roadsBuilt: number;
  settlersSpawned: number;
  // Military (MILITARY.md). Player-agnostic tallies for the HUD + e2e.
  soldiersRecruited: number;
  militaryOccupied: number;
  territoryChanges: number;
  fightsStarted: number;
  soldiersDied: number;
  buildingsCaptured: number;
  soldiersPromoted: number;
  catapultShots: number;
}

function zeroCounters(): GameCounters {
  return {
    treesFelled: 0,
    treesPlanted: 0,
    stonesMined: 0,
    trunksProduced: 0,
    planksProduced: 0,
    stonesProduced: 0,
    waresDelivered: 0,
    buildingsPlaced: 0,
    buildingsCompleted: 0,
    flagsPlaced: 0,
    roadsBuilt: 0,
    settlersSpawned: 0,
    soldiersRecruited: 0,
    militaryOccupied: 0,
    territoryChanges: 0,
    fightsStarted: 0,
    soldiersDied: 0,
    buildingsCaptured: 0,
    soldiersPromoted: 0,
    catapultShots: 0,
  };
}

/** Supported simulation speeds (tick-rate multipliers). */
export const SPEEDS = [1, 3, 10] as const;
export type Speed = (typeof SPEEDS)[number];

/** A running game over one map for a single local player (player 0). */
export class GameSession {
  /** Live world state. Replaced wholesale by {@link loadWorld} (save load). */
  world: World;
  /** Geometry over {@link world}; rebuilt when the world is replaced. */
  geom: Geometry;
  readonly rules = GREENLAND_RULES;
  readonly counters: GameCounters = zeroCounters();

  paused = false;
  speed: Speed = 1;
  /** Set when a tick changes map objects, so the renderer rebuilds statics. */
  staticsDirty = true;

  /** The local (human) player index. Others render but are idle (no AI yet). */
  readonly localPlayer = 0;
  /** True when fog of war modulates rendering (toggleable HUD debug button). */
  fogEnabled = true;
  /** Set when visibility changed, so the renderer re-uploads the fog layer. */
  fogDirty = true;
  /** Set when territory changed, so the border/minimap overlays refresh. */
  territoryDirty = true;

  /** Per-node fog state (0 unexplored, 1 explored, 2 visible). Persistent. */
  readonly visibility: Uint8Array;

  private acc = 0;
  /** Sound cues emitted since the last drain (bounded to avoid unbounded growth). */
  private readonly soundCues: SoundCue[] = [];

  constructor(map: MapJson, seed: number, players?: number) {
    this.world = createWorld(map, { seed, players });
    this.geom = worldGeometry(this.world);
    this.visibility = new Uint8Array(this.world.width * this.world.height);
    this.recomputeVisibility();
  }

  /** Number of players seeded in this world. */
  get playerCount(): number {
    return this.world.players.length;
  }

  /** Player-0 warehouse ware counts. */
  get inventory(): { trunk: number; plank: number; stone: number } {
    const w = this.world.players[0]?.wares;
    return { trunk: w?.trunk ?? 0, plank: w?.plank ?? 0, stone: w?.stone ?? 0 };
  }

  /**
   * Advance real time by `dtMs`, running as many fixed ticks as fit. Returns
   * the interpolation fraction into the next tick for smooth rendering.
   */
  update(dtMs: number): number {
    const interval = GF_MS / this.speed;
    if (!this.paused) {
      this.acc += dtMs;
      let steps = 0;
      while (this.acc >= interval && steps < MAX_STEPS_PER_UPDATE) {
        this.step();
        this.acc -= interval;
        steps++;
      }
      if (steps >= MAX_STEPS_PER_UPDATE) this.acc = 0;
    }
    return this.paused ? 0 : Math.min(1, this.acc / interval);
  }

  private step(): void {
    for (const e of tickWorld(this.world, this.rules)) this.record(e);
  }

  // --- Save / load ----------------------------------------------------------

  /** Canonical, JSON-safe serialization of the current world (for a save). */
  serialize(): unknown {
    return JSON.parse(serializeWorld(this.world)) as unknown;
  }

  /**
   * Replace the live world from serialized save data (as produced by
   * {@link serialize}). The tick loop keeps running against the new world;
   * geometry is rebuilt and statics are flagged dirty so the renderer refreshes.
   * Throws if the data is not a compatible world version.
   */
  loadWorld(data: unknown): void {
    const next = deserializeWorld(JSON.stringify(data));
    this.world = next;
    this.geom = worldGeometry(next);
    this.acc = 0;
    this.staticsDirty = true;
    this.territoryDirty = true;
    this.soundCues.length = 0;
    this.visibility.fill(FOG.unexplored);
    this.recomputeVisibility();
  }

  /**
   * Drain the sound cues collected since the last call (one-shot audio for the
   * frame). Returns a fresh array; the internal buffer is cleared.
   */
  drainSoundCues(): SoundCue[] {
    if (this.soundCues.length === 0) return [];
    const out = this.soundCues.slice();
    this.soundCues.length = 0;
    return out;
  }

  private record(e: ReturnType<typeof tickWorld>[number]): void {
    const cue = soundForEvent(e, this.world);
    // Bound the buffer: at extreme catch-up the renderer may skip a drain.
    if (cue && this.soundCues.length < 64) this.soundCues.push(cue);
    const c = this.counters;
    switch (e.type) {
      case 'TreeFelled':
        c.treesFelled++;
        this.staticsDirty = true;
        break;
      case 'TreePlanted':
        c.treesPlanted++;
        this.staticsDirty = true;
        break;
      case 'StoneMined':
        c.stonesMined++;
        this.staticsDirty = true;
        break;
      case 'WareProduced':
        if (e.wareType === 'trunk') c.trunksProduced++;
        else if (e.wareType === 'plank') c.planksProduced++;
        else if (e.wareType === 'stone') c.stonesProduced++;
        break;
      case 'WareDelivered':
        c.waresDelivered++;
        break;
      case 'BuildingPlaced':
        c.buildingsPlaced++;
        this.staticsDirty = true;
        break;
      case 'BuildingCompleted':
        c.buildingsCompleted++;
        break;
      case 'BuildingDemolished':
        this.staticsDirty = true;
        break;
      case 'FlagPlaced':
        c.flagsPlaced++;
        break;
      case 'RoadBuilt':
        c.roadsBuilt++;
        break;
      case 'SettlerSpawned':
        c.settlersSpawned++;
        break;
      case 'SoldierRecruited':
        c.soldiersRecruited++;
        break;
      case 'MilitaryOccupied':
        c.militaryOccupied++;
        break;
      case 'TerritoryChanged':
        c.territoryChanges++;
        this.territoryDirty = true;
        this.recomputeVisibility();
        break;
      case 'FightStarted':
        c.fightsStarted++;
        break;
      case 'SoldierDied':
        c.soldiersDied++;
        break;
      case 'BuildingCaptured':
        c.buildingsCaptured++;
        this.staticsDirty = true; // a razed HQ clears its marker
        this.territoryDirty = true;
        this.recomputeVisibility();
        break;
      case 'SoldierPromoted':
        c.soldiersPromoted++;
        break;
      case 'CatapultFired':
        c.catapultShots++;
        break;
      default:
        break;
    }
  }

  // --- Fog of war (MILITARY.md §3) ------------------------------------------

  /**
   * Recompute the local player's per-node fog state from the engine's
   * {@link visibleNodes} view: currently-visible nodes become `visible`, and
   * every node ever seen stays at least `explored` (persistent memory). Marks
   * the fog layer dirty so the renderer re-uploads it next frame.
   */
  recomputeVisibility(): void {
    const vis = this.visibility;
    const seen = visibleNodes(this.world, this.localPlayer);
    for (let node = 0; node < vis.length; node++) {
      if (seen.has(node)) vis[node] = FOG.visible;
      else if (vis[node] === FOG.visible) vis[node] = FOG.explored;
    }
    this.fogDirty = true;
  }

  // --- Command surface (player 0; queued at the current tick) ---------------

  placeFlag(node: number): void {
    applyCommand(this.world, { type: 'placeFlag', player: 0, node });
  }

  placeBuilding(node: number, buildingType: BuildingType): void {
    applyCommand(this.world, { type: 'placeBuilding', player: 0, node, buildingType });
  }

  buildRoad(path: number[]): void {
    applyCommand(this.world, { type: 'buildRoad', player: 0, path });
  }

  demolish(node: number): void {
    applyCommand(this.world, { type: 'demolish', player: 0, node });
  }

  // --- Queries --------------------------------------------------------------

  canFlag(node: number): boolean {
    return canPlaceFlag(this.world, this.geom, this.rules, node);
  }

  canBuild(node: number, buildingType: BuildingType): boolean {
    return canPlaceBuilding(this.world, this.geom, this.rules, node, buildingType);
  }

  /** The flag id at a node for player 0, or -1. */
  flagIdAt(node: number): number {
    const f = flagAt(this.world, node);
    return f && f.player === 0 ? f.id : -1;
  }

  /**
   * Suggest a road node path from `startNode` to `endNode` over walkable ground
   * (inclusive of both endpoints), or null when unreachable. Uses the same
   * lattice A* the engine drives settlers with.
   */
  suggestRoad(startNode: number, endNode: number): number[] | null {
    if (startNode === endNode) return null;
    const rest = findWalkPath(this.world, this.geom, this.rules, startNode, endNode);
    if (!rest || rest.length === 0) return null;
    return [startNode, ...rest];
  }

  // --- Military command surface + queries (MILITARY.md) ---------------------

  /** The building id at a node, or -1. */
  buildingIdAt(node: number): number {
    return buildingAt(this.world, node)?.id ?? -1;
  }

  /** Garrison/coin snapshot of the military building at a node, or null. */
  militaryAt(node: number): MilitaryView | null {
    const b = buildingAt(this.world, node);
    return b ? militaryView(this.world, b.id) : null;
  }

  /** Owning player of a node (-1 = neutral). */
  ownerOf(node: number): number {
    return ownerAt(this.world, node);
  }

  /** Owned nodes of a player. */
  territory(player: number): number[] {
    return territoryOf(this.world, player);
  }

  /** Border-ring nodes of a player (small posts in the original). */
  borders(player: number): number[] {
    return borderNodes(this.world, player);
  }

  /** Toggle gold-coin delivery to one of the local player's military buildings. */
  toggleCoins(buildingId: number, enabled: boolean): void {
    applyCommand(this.world, {
      type: 'toggleCoins',
      player: this.localPlayer,
      buildingId,
      enabled,
    });
  }

  /** Order up to `soldiers` attackers against an enemy military building. */
  attack(targetBuildingId: number, soldiers: number): void {
    applyCommand(this.world, {
      type: 'attack',
      player: this.localPlayer,
      targetBuildingId,
      soldiers,
    });
  }

  /**
   * How many soldiers the local player could send against `targetBuildingId`
   * right now (mirrors the engine's attack gathering: leave 1 as garrison, lose
   * attackers past the base distance, require a reachable on-foot path). 0 = the
   * target is invalid or out of reach, so the UI hides the Attack action.
   */
  attackableSoldiers(targetBuildingId: number): number {
    const world = this.world;
    const geom = this.geom;
    const target = world.buildings.items[targetBuildingId];
    if (!target || target.player === this.localPlayer) return 0;
    const tdef = buildingDef(target.type);
    if (!tdef || tdef.kind !== 'military' || !target.occupied) return 0;
    let total = 0;
    for (const b of world.buildings.items) {
      if (!b || b.player !== this.localPlayer || !b.occupied) continue;
      const bdef = buildingDef(b.type);
      if (!bdef || bdef.kind !== 'military') continue;
      const troops = militaryView(world, b.id)?.troops ?? 0;
      if (troops <= 1) continue;
      const dist = geom.distance(b.node, target.node);
      let sendable = troops - 1;
      if (dist > MILITARY_ATTACK.baseDistance) sendable -= dist - MILITARY_ATTACK.baseDistance;
      if (sendable <= 0) continue;
      const path = findWalkPath(world, geom, this.rules, b.node, target.node);
      if (!path || path.length > MILITARY_ATTACK.maxRunDistance) continue;
      total += sendable;
    }
    return total;
  }

  /** Toggle fog of war on/off (HUD debug button). Marks the layer dirty. */
  setFog(enabled: boolean): void {
    this.fogEnabled = enabled;
    this.fogDirty = true;
  }

  /**
   * Debug/e2e cheat: drop a fully-built, unoccupied military building (plus its
   * door flag) for `player` at `node`, bypassing construction. The engine's
   * occupation machinery then walks a soldier in, activates territory and emits
   * MilitaryOccupied/TerritoryChanged — exactly as a normally-built one would.
   * Returns the new building id, or -1 when the site is not free.
   */
  debugSpawnMilitary(player: number, node: number, type: BuildingType): number {
    const world = this.world;
    const geom = this.geom;
    const def = buildingDef(type);
    if (!def || def.kind !== 'military') return -1;
    if (world.buildingAtNode[node] >= 0 || world.flagAtNode[node] >= 0) return -1;
    const flagNode = geom.neighbour(node, 'SE');
    if (world.buildingAtNode[flagNode] >= 0) return -1;
    let flagId = world.flagAtNode[flagNode];
    if (flagId < 0) {
      flagId = storeAllocLocal<Flag>(world.flags, (id) => ({
        id,
        node: flagNode,
        player,
        wares: [],
      }));
      world.flagAtNode[flagNode] = flagId;
    }
    const bId = storeAllocLocal<Building>(world.buildings, (id) => ({
      id,
      type,
      node,
      player,
      flagId,
      state: 'working',
      deliveredBoards: def.cost.boards,
      deliveredStones: def.cost.stones,
      needBoards: def.cost.boards,
      needStones: def.cost.stones,
      buildProgress: 0,
      buildTicks: 0,
      workerId: -1,
      staffed: false,
      inputStock: new Array<number>(def.inputs.length).fill(0),
      outputQueue: [],
      workTimer: 0,
      altToggle: 0,
      garrison: new Array<number>(NUM_SOLDIER_RANKS).fill(0),
      occupied: false,
      coinsEnabled: true,
      incoming: 0,
      promotionTimer: -1,
    }));
    world.buildingAtNode[node] = bId;
    return bId;
  }
}
