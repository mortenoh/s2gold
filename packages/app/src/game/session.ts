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
  canPlaceHarbor,
  createAiState,
  createWorld,
  deserializeWorld,
  expeditionStatus,
  findWalkPath,
  findWaterPath,
  flagAt,
  rulesForLandscape,
  harborDockNode,
  harborsOf,
  militaryView,
  MILITARY_ATTACK,
  NUM_SOLDIER_RANKS,
  ownerAt,
  runAi,
  SEA,
  serializeWorld,
  shipsOf,
  resourceAmount,
  resourceType,
  territoryOf,
  tickWorld,
  visibleNodes,
  worldGeometry,
  type AiState,
  type Building,
  type BuildingType,
  type ExpeditionView,
  type Flag,
  type Geometry,
  type MapJson,
  type MilitaryView,
  type Ship,
  type TerrainRules,
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

/** Ticks between statistics samples (cheap, tick-aligned; ~2.5s of GF at 1x). */
export const STATS_INTERVAL = 50;
/** Ring-buffer length per series (STATS_INTERVAL * this = ticks of history). */
const STATS_MAX = 300;
/** Deterministic base seed for AI RNG streams (mixed per player in the engine). */
const AI_SEED = 0x5eed;

/**
 * Per-player statistics time series (parallel ring buffers). Sampled every
 * {@link STATS_INTERVAL} ticks. Indices line up with {@link GameSession.statsTicks}.
 */
export interface StatsSeries {
  /** Territory node count (owned land). */
  land: number[];
  /** Live building count (sites + working, HQ included). */
  buildings: number[];
  /** Total soldiers (warehouse reserve + garrisoned across all buildings). */
  soldiers: number[];
  /** Total wares held in the player's warehouses. */
  goods: number[];
}

/**
 * JSON-safe snapshot of the stats ring buffers, embedded in a save so the
 * history graphs reload consistent with the save's timeline. Parallel to the
 * live {@link GameSession.statsTicks}/{@link GameSession.statsSeries} state.
 */
export interface SerializedStats {
  ticks: number[];
  nextTick: number;
  series: StatsSeries[];
}

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
  // Seafaring (P7). Player-agnostic tallies for the HUD + e2e.
  shipsBuilt: number;
  shipsArrived: number;
  expeditionsReady: number;
  expeditionsLanded: number;
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
    shipsBuilt: 0,
    shipsArrived: 0,
    expeditionsReady: 0,
    expeditionsLanded: 0,
  };
}

/** Supported simulation speeds (tick-rate multipliers). 25x/50x are for quickly
 * fast-forwarding while testing; the per-frame step cap keeps them from spiralling. */
export const SPEEDS = [1, 3, 10, 25, 50] as const;
export type Speed = (typeof SPEEDS)[number];

/** A running game over one map for a single local player (player 0). */
export class GameSession {
  /** Live world state. Replaced wholesale by {@link loadWorld} (save load). */
  world: World;
  /** Geometry over {@link world}; rebuilt when the world is replaced. */
  geom: Geometry;
  /** Terrain rules selected from the map's landscape (winter/wasteland/greenland). */
  readonly rules: TerrainRules;
  readonly counters: GameCounters = zeroCounters();

  paused = false;
  speed: Speed = 1;
  /** Set when a tick changes map objects, so the renderer rebuilds statics. */
  staticsDirty = true;

  /** The local (human) player index. Other players are AI-driven or idle. */
  readonly localPlayer = 0;
  /** True when fog of war modulates rendering (toggleable HUD debug button). */
  fogEnabled = true;
  /** Set when visibility changed, so the renderer re-uploads the fog layer. */
  fogDirty = true;
  /** Set when territory changed, so the border/minimap overlays refresh. */
  territoryDirty = true;

  /** Per-node fog state (0 unexplored, 1 explored, 2 visible). Persistent. */
  readonly visibility: Uint8Array;

  /**
   * Per-player AI decision state (one per computer player). Run once per tick
   * just before `tickWorld`. Empty when no computer opponents are configured.
   * Serialized into saves and restored on load (see {@link serialize}).
   */
  aiStates: AiState[] = [];

  /** Sample ticks parallel to {@link statsSeries} entries (shared time axis). */
  statsTicks: number[] = [];
  /** Per-player statistics series (index = player). Rebuilt on world replace. */
  statsSeries: StatsSeries[] = [];
  private nextStatsTick = 0;

  private acc = 0;
  /** Sound cues emitted since the last drain (bounded to avoid unbounded growth). */
  private readonly soundCues: SoundCue[] = [];

  constructor(map: MapJson, seed: number, players?: number, aiPlayers?: readonly number[]) {
    this.world = createWorld(map, { seed, players });
    this.rules = rulesForLandscape(map.terrain ?? 0);
    this.geom = worldGeometry(this.world);
    this.visibility = new Uint8Array(this.world.width * this.world.height);
    this.recomputeVisibility();
    for (const id of aiPlayers ?? []) {
      if (id >= 0 && id < this.world.players.length) {
        this.aiStates.push(createAiState(id, { seed: AI_SEED }));
      }
    }
    this.initStats();
  }

  /** Player indices currently driven by the computer opponent. */
  get aiPlayers(): number[] {
    return this.aiStates.map((s) => s.playerId);
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

  /** The local player's full ware inventory (all goods) for the goods window. */
  get goods(): Record<string, number> {
    return { ...(this.world.players[0]?.wares ?? {}) };
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
    // Statistics: tick-aligned sample of the state entering this tick (cheap
    // counts only). Sampling here also captures the very first (tick 0) point.
    if (this.world.tick >= this.nextStatsTick) {
      this.recordStatsSample();
      this.nextStatsTick = this.world.tick + STATS_INTERVAL;
    }
    // Computer opponents act just before the tick, through the command layer —
    // identical to a human queueing commands (see engine ai/ notes).
    for (const ai of this.aiStates) runAi(this.world, ai, this.rules);
    for (const e of tickWorld(this.world, this.rules)) this.record(e);
  }

  // --- Statistics (in-game stats screen) ------------------------------------

  /** (Re)allocate empty per-player series sized to the current player count. */
  private initStats(): void {
    this.statsTicks = [];
    this.statsSeries = [];
    for (let p = 0; p < this.playerCount; p++) {
      this.statsSeries.push({ land: [], buildings: [], soldiers: [], goods: [] });
    }
    this.nextStatsTick = 0;
    // Seed one baseline sample so a freshly-opened panel is never empty.
    this.recordStatsSample();
    this.nextStatsTick = this.world.tick + STATS_INTERVAL;
  }

  /**
   * Push one statistics sample for every player. All four metrics are derived
   * cheaply from live state (no engine views added): a single pass over the
   * owner plane for land, one over the building store for buildings/soldiers,
   * and a warehouse-ware sum for goods. Ring-buffered to {@link STATS_MAX}.
   */
  private recordStatsSample(): void {
    const w = this.world;
    const n = this.playerCount;
    const land = new Array<number>(n).fill(0);
    const buildings = new Array<number>(n).fill(0);
    const soldiers = new Array<number>(n).fill(0);
    const goods = new Array<number>(n).fill(0);
    // Land: one pass over the owner plane.
    for (let node = 0; node < w.owner.length; node++) {
      const p = ownerAt(w, node);
      if (p >= 0 && p < n) land[p]++;
    }
    // Buildings + garrisoned soldiers: one pass over the building store.
    for (const b of w.buildings.items) {
      if (!b || b.player < 0 || b.player >= n) continue;
      buildings[b.player]++;
      for (const g of b.garrison) soldiers[b.player] += g;
    }
    // Reserve soldiers (warehouse) + total warehouse wares.
    for (let p = 0; p < n; p++) {
      const pl = w.players[p];
      if (!pl) continue;
      for (const s of pl.soldiers) soldiers[p] += s;
      for (const count of Object.values(pl.wares)) goods[p] += count;
    }
    this.statsTicks.push(w.tick);
    for (let p = 0; p < n; p++) {
      const s = this.statsSeries[p];
      if (!s) continue;
      s.land.push(land[p] ?? 0);
      s.buildings.push(buildings[p] ?? 0);
      s.soldiers.push(soldiers[p] ?? 0);
      s.goods.push(goods[p] ?? 0);
    }
    if (this.statsTicks.length > STATS_MAX) {
      this.statsTicks.shift();
      for (const s of this.statsSeries) {
        s.land.shift();
        s.buildings.shift();
        s.soldiers.shift();
        s.goods.shift();
      }
    }
  }

  /** Live building count for a player (HQ + sites + working). */
  buildingsOf(player: number): number {
    let n = 0;
    for (const b of this.world.buildings.items) if (b && b.player === player) n++;
    return n;
  }

  // --- Save / load ----------------------------------------------------------

  /**
   * Canonical, JSON-safe save payload: `{ world, counters, stats, ai }`.
   * `counters` and `stats` are presentation-side tallies (the Stats panel HUD
   * and its history graphs) that the deterministic engine does not track, so
   * they ride alongside the world to stay consistent with the save's timeline.
   * `ai` maps each computer player's index to its serializable {@link AiState}
   * and is omitted (absent, not empty) when there are no computer players.
   *
   * Backward compatibility: {@link loadWorld} still accepts a bare world object
   * (the pre-wrapper save shape). In that case AI states are preserved and the
   * counters/stats reset to zero — there is nothing to restore them from.
   */
  serialize(): unknown {
    const world = JSON.parse(serializeWorld(this.world)) as unknown;
    const payload: {
      world: unknown;
      counters: GameCounters;
      stats: SerializedStats;
      ai?: Record<number, AiState>;
    } = { world, counters: { ...this.counters }, stats: this.serializeStats() };
    if (this.aiStates.length > 0) {
      const ai: Record<number, AiState> = {};
      for (const s of this.aiStates) ai[s.playerId] = s;
      payload.ai = ai;
    }
    return payload;
  }

  /** Snapshot the stats ring buffers into a JSON-safe (deep-copied) shape. */
  private serializeStats(): SerializedStats {
    return {
      ticks: this.statsTicks.slice(),
      nextTick: this.nextStatsTick,
      series: this.statsSeries.map((s) => ({
        land: s.land.slice(),
        buildings: s.buildings.slice(),
        soldiers: s.soldiers.slice(),
        goods: s.goods.slice(),
      })),
    };
  }

  /**
   * Replace the live world from serialized save data (as produced by
   * {@link serialize}). Accepts either the current `{ world, counters, stats, ai }`
   * shape or a bare pre-wrapper world object. The tick loop keeps running against
   * the new world; geometry is rebuilt and statics are flagged dirty so the
   * renderer refreshes. Presentation counters and stats history are restored from
   * the save when present, or reset to zero for a bare (old-format) world so the
   * Stats panel reflects the loaded timeline rather than the pre-load one.
   * Throws if the world data is not a compatible version.
   */
  loadWorld(data: unknown): void {
    let worldData: unknown = data;
    let aiData: Record<string, AiState> | undefined;
    let counterData: unknown;
    let statsData: unknown;
    if (data && typeof data === 'object' && 'world' in data) {
      const wrapped = data as {
        world: unknown;
        ai?: Record<string, AiState>;
        counters?: unknown;
        stats?: unknown;
      };
      worldData = wrapped.world;
      aiData = wrapped.ai;
      counterData = wrapped.counters;
      statsData = wrapped.stats;
    }
    const next = deserializeWorld(JSON.stringify(worldData));
    this.world = next;
    this.geom = worldGeometry(next);
    // Restore AI states from the save when present; otherwise (a pre-AI save)
    // keep the session's existing AI states so a mid-game load stays consistent.
    if (aiData) {
      this.aiStates = Object.values(aiData).filter((s) => s.playerId < next.players.length);
    } else {
      this.aiStates = this.aiStates.filter((s) => s.playerId < next.players.length);
    }
    this.acc = 0;
    this.staticsDirty = true;
    this.territoryDirty = true;
    this.soundCues.length = 0;
    this.visibility.fill(FOG.unexplored);
    this.recomputeVisibility();
    // Presentation-side tallies are not part of the world, so restore them
    // explicitly. Old-format saves carry neither and correctly reset to zero.
    this.restoreCounters(counterData);
    if (!this.restoreStats(statsData)) this.initStats();
  }

  /** Overwrite the live counters from a save, zeroing any absent/invalid field. */
  private restoreCounters(source: unknown): void {
    const zeroed = zeroCounters();
    if (source && typeof source === 'object') {
      const src = source as Record<string, unknown>;
      for (const key of Object.keys(zeroed) as (keyof GameCounters)[]) {
        const v = src[key];
        if (typeof v === 'number' && Number.isFinite(v)) zeroed[key] = v;
      }
    }
    Object.assign(this.counters, zeroed);
  }

  /**
   * Restore the stats ring buffers from a save. Returns false (leaving stats
   * untouched) when the payload is missing or does not match the loaded world's
   * player count, so the caller falls back to a fresh {@link initStats}.
   */
  private restoreStats(source: unknown): boolean {
    if (!source || typeof source !== 'object') return false;
    const s = source as { ticks?: unknown; nextTick?: unknown; series?: unknown };
    if (!Array.isArray(s.ticks) || !Array.isArray(s.series)) return false;
    if (s.series.length !== this.playerCount) return false;
    const series: StatsSeries[] = [];
    for (const raw of s.series) {
      if (!raw || typeof raw !== 'object') return false;
      const r = raw as Record<string, unknown>;
      const { land, buildings, soldiers, goods } = r;
      if (
        !Array.isArray(land) ||
        !Array.isArray(buildings) ||
        !Array.isArray(soldiers) ||
        !Array.isArray(goods)
      ) {
        return false;
      }
      series.push({
        land: (land as number[]).slice(),
        buildings: (buildings as number[]).slice(),
        soldiers: (soldiers as number[]).slice(),
        goods: (goods as number[]).slice(),
      });
    }
    this.statsTicks = (s.ticks as number[]).slice();
    this.statsSeries = series;
    this.nextStatsTick =
      typeof s.nextTick === 'number' ? s.nextTick : this.world.tick + STATS_INTERVAL;
    return true;
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
      case 'ShipBuilt':
        c.shipsBuilt++;
        break;
      case 'ShipArrived':
        c.shipsArrived++;
        break;
      case 'ExpeditionReady':
        c.expeditionsReady++;
        break;
      case 'ExpeditionLanded':
        c.expeditionsLanded++;
        this.staticsDirty = true; // the founded harbor clears its site node
        this.territoryDirty = true;
        this.recomputeVisibility();
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

  /** Send a geologist from a flag to survey nearby mountains for ore. */
  sendGeologist(flagNode: number): void {
    applyCommand(this.world, { type: 'sendGeologist', player: 0, flagNode });
  }

  /** The surveyed resource kind (RESOURCE.*) at a node, or -1 if not surveyed.
   * Reflects the CURRENT deposit, so a mined-out spot reads as nothing (0). */
  signAt(node: number): number {
    const surveyed = this.world.signs.some((s) => s.node === node);
    if (!surveyed) return -1;
    return resourceAmount(this.world.resource[node]) > 0
      ? resourceType(this.world.resource[node])
      : 0;
  }

  demolish(node: number): void {
    applyCommand(this.world, { type: 'demolish', player: 0, node });
  }

  // --- Queries --------------------------------------------------------------

  canFlag(node: number): boolean {
    return canPlaceFlag(this.world, this.geom, this.rules, node, this.localPlayer);
  }

  canBuild(node: number, buildingType: BuildingType): boolean {
    return canPlaceBuilding(
      this.world,
      this.geom,
      this.rules,
      node,
      buildingType,
      this.localPlayer,
    );
  }

  /**
   * Debug/e2e: is `node` a valid coastal harbor site ignoring territory ownership?
   * Mirrors {@link debugSpawnHarbor}'s bypass so a test can locate the sites the
   * cheat can actually found (the real build UI uses the player-enforced
   * {@link canBuild}).
   */
  debugCanPlaceHarbor(node: number): boolean {
    return canPlaceHarbor(this.world, this.geom, this.rules, node);
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
    // blockFlags: a road can't cross another flag, so plan around interior flags
    // — otherwise the path previews as valid but buildRoad silently rejects it.
    // ownedBy: execBuildRoad rejects any node outside the player's territory,
    // so the preview must plan around foreign land the same way the AI does.
    const rest = findWalkPath(
      this.world,
      this.geom,
      this.rules,
      startNode,
      endNode,
      true,
      this.localPlayer,
    );
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

  // --- Seafaring command surface + queries (P7) -----------------------------

  /** Begin assembling an expedition kit at one of the local player's harbors. */
  prepareExpedition(harborId: number): void {
    applyCommand(this.world, { type: 'prepareExpedition', player: this.localPlayer, harborId });
  }

  /** Launch a ready expedition from a harbor toward a coastal target spot. */
  startExpedition(harborId: number, targetSpot: number): void {
    applyCommand(this.world, {
      type: 'startExpedition',
      player: this.localPlayer,
      harborId,
      targetSpot,
    });
  }

  /** The local player's own working harbor at a node, or null. */
  harborAt(node: number): Building | null {
    const b = buildingAt(this.world, node);
    return b && b.player === this.localPlayer && b.type === 'harbor' && b.state === 'working'
      ? b
      : null;
  }

  /** Pending-expedition snapshot at a harbor, or null when none is prepared. */
  expeditionAt(harborId: number): ExpeditionView | null {
    return expeditionStatus(this.world, harborId);
  }

  /** True when an idle, empty ship of the local player is homed at `harborId`. */
  hasIdleShipAt(harborId: number): boolean {
    for (const s of shipsOf(this.world, this.localPlayer)) {
      if (s.homeHarborId === harborId && s.state === 'idle' && s.cargo.length === 0) return true;
    }
    return false;
  }

  /** Working harbors of the local player (id order). */
  harbors(): Building[] {
    return harborsOf(this.world, this.localPlayer);
  }

  /** Ship entities of the local player (id order). */
  ships(): Ship[] {
    return shipsOf(this.world, this.localPlayer);
  }

  /** Debug/e2e: live ships as {id, node, state} (all players; id order). */
  shipStates(): { id: number; node: number; state: string }[] {
    const out: { id: number; node: number; state: string }[] = [];
    for (const s of this.world.ships.items) {
      if (s) out.push({ id: s.id, node: s.node, state: s.state });
    }
    return out;
  }

  /**
   * Debug/e2e cheat: found a fully-working harbor (HQ-lite warehouse) for
   * `player` at a coastal `node`, bypassing construction, plus its SE door flag.
   * Returns the new building id, or -1 when the spot is not a valid harbor site.
   * Territory does not activate until the next global recalc (a military event or
   * a founded expedition), matching the engine's own harbor anchoring.
   */
  debugSpawnHarbor(player: number, node: number): number {
    const world = this.world;
    const geom = this.geom;
    // Cheat path: bypass territory ownership (pass no player) so a test can found
    // a harbor on any valid coastal site, including unclaimed coast. The real
    // build/preview paths (canBuild) stay player-enforced.
    if (!canPlaceHarbor(world, geom, this.rules, node)) return -1;
    const def = buildingDef('harbor');
    if (!def) return -1;
    const flagNode = geom.neighbour(node, 'SE');
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
      type: 'harbor',
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
      staffed: true,
      inputStock: [],
      outputQueue: [],
      workTimer: 0,
      altToggle: 0,
      garrison: new Array<number>(NUM_SOLDIER_RANKS).fill(0),
      occupied: false,
      coinsEnabled: false,
      incoming: 0,
      promotionTimer: -1,
    }));
    world.buildingAtNode[node] = bId;
    return bId;
  }

  /**
   * Debug/e2e cheat: dock an idle, empty ship of `player` at `harborId` (bypasses
   * shipyard construction). Returns the new ship id, or -1 when the harbor has no
   * navigable-water dock.
   */
  debugSpawnShip(player: number, harborId: number): number {
    const world = this.world;
    const harbor = world.buildings.items[harborId];
    if (!harbor || harbor.type !== 'harbor') return -1;
    const dock = harborDockNode(world, this.geom, harbor.node);
    if (dock < 0) return -1;
    return storeAllocLocal<Ship>(world.ships, (id) => ({
      id,
      player,
      node: dock,
      state: 'idle',
      homeHarborId: harborId,
      destHarborId: -1,
      path: [],
      pathIndex: 0,
      edgeProgress: 0,
      ticksPerEdge: SEA.ticksPerEdge,
      cargo: [],
      expeditionTargetSpot: -1,
      expeditionBoards: 0,
      expeditionStones: 0,
      expeditionBuilder: false,
    }));
  }

  /**
   * Debug/e2e cheat: top up `player`'s warehouse with an expedition kit worth of
   * boards + stones and an idle builder, so a prepared expedition assembles at
   * once. Exercises the real assembly path (no expedition state is forced ready).
   */
  debugGrantExpeditionSupplies(player: number): void {
    const p = this.world.players[player];
    if (!p) return;
    p.wares.plank = (p.wares.plank ?? 0) + SEA.expeditionBoards;
    p.wares.stone = (p.wares.stone ?? 0) + SEA.expeditionStones;
    p.workers.builder = (p.workers.builder ?? 0) + 1;
  }

  /** Debug/e2e: is there an all-water route between the docks of two coastal nodes? */
  debugWaterConnected(nodeA: number, nodeB: number): boolean {
    const dockA = harborDockNode(this.world, this.geom, nodeA);
    const dockB = harborDockNode(this.world, this.geom, nodeB);
    if (dockA < 0 || dockB < 0) return false;
    return findWaterPath(this.world, this.geom, dockA, dockB) !== null;
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
