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
  canPlaceBuilding,
  canPlaceFlag,
  createWorld,
  findWalkPath,
  flagAt,
  GREENLAND_RULES,
  tickWorld,
  worldGeometry,
  type BuildingType,
  type Geometry,
  type MapJson,
  type World,
} from '@s2gold/engine';
import { soundForEvent, type SoundCue } from './audio-map';

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
  };
}

/** Supported simulation speeds (tick-rate multipliers). */
export const SPEEDS = [1, 3, 10] as const;
export type Speed = (typeof SPEEDS)[number];

/** A running game over one map for a single local player (player 0). */
export class GameSession {
  readonly world: World;
  readonly geom: Geometry;
  readonly rules = GREENLAND_RULES;
  readonly counters: GameCounters = zeroCounters();

  paused = false;
  speed: Speed = 1;
  /** Set when a tick changes map objects, so the renderer rebuilds statics. */
  staticsDirty = true;

  private acc = 0;
  /** Sound cues emitted since the last drain (bounded to avoid unbounded growth). */
  private readonly soundCues: SoundCue[] = [];

  constructor(map: MapJson, seed: number) {
    this.world = createWorld(map, { seed, players: 1 });
    this.geom = worldGeometry(this.world);
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
      default:
        break;
    }
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
}
