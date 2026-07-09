/**
 * Per-tick event list. Events are append-only signals for one-shot effects
 * (sounds, animations, UI notifications). Continuous motion is NOT an event —
 * the renderer reads world state directly. `tickWorld` returns the events
 * emitted during that game frame, in emission order.
 */

import type { BuildingType, JobType, WareType } from './constants';

export interface FlagPlaced {
  type: 'FlagPlaced';
  flagId: number;
  node: number;
  player: number;
}

export interface RoadBuilt {
  type: 'RoadBuilt';
  roadId: number;
  from: number;
  to: number;
  player: number;
}

export interface BuildingPlaced {
  type: 'BuildingPlaced';
  buildingId: number;
  buildingType: BuildingType;
  node: number;
  player: number;
}

export interface BuildingCompleted {
  type: 'BuildingCompleted';
  buildingId: number;
  buildingType: BuildingType;
  node: number;
  player: number;
}

export interface BuildingDemolished {
  type: 'BuildingDemolished';
  buildingId: number;
  node: number;
  player: number;
}

export interface TreeFelled {
  type: 'TreeFelled';
  node: number;
  player: number;
}

export interface TreePlanted {
  type: 'TreePlanted';
  node: number;
  player: number;
}

export interface StoneMined {
  type: 'StoneMined';
  node: number;
  player: number;
}

export interface WareProduced {
  type: 'WareProduced';
  wareId: number;
  wareType: WareType;
  buildingId: number;
  player: number;
}

export interface WareDelivered {
  type: 'WareDelivered';
  wareType: WareType;
  buildingId: number;
  player: number;
}

export interface SettlerSpawned {
  type: 'SettlerSpawned';
  settlerId: number;
  job: JobType;
  player: number;
}

/**
 * A worker began a work cycle. `kind` classifies the sound/animation
 * (sawing, hammering, mining, chopping, planting, ...). Audible-effect signal.
 */
export interface WorkStarted {
  type: 'WorkStarted';
  kind: string;
  buildingId: number;
  node: number;
  player: number;
}

/** A farmer sowed a grain field on a map node. */
export interface CropPlanted {
  type: 'CropPlanted';
  node: number;
  player: number;
}

/** A farmer harvested a mature grain field (yields 1 grain). */
export interface CropHarvested {
  type: 'CropHarvested';
  node: number;
  player: number;
}

/** A mine ran out of matching subsurface resource within its radius. */
export interface MineDepleted {
  type: 'MineDepleted';
  buildingId: number;
  node: number;
  player: number;
}

/** A new civilian settler was recruited from a Helper (+ tool). CONSTANTS.md §7. */
export interface SettlerRecruited {
  type: 'SettlerRecruited';
  job: JobType;
  tool: WareType | null;
  player: number;
}

/** A donkey breeder bred a pack donkey (road-capacity upgrade stub). */
export interface DonkeyBred {
  type: 'DonkeyBred';
  buildingId: number;
  player: number;
}

/** Discriminated union of every emitted event. */
export type GameEvent =
  | FlagPlaced
  | RoadBuilt
  | BuildingPlaced
  | BuildingCompleted
  | BuildingDemolished
  | TreeFelled
  | TreePlanted
  | StoneMined
  | WareProduced
  | WareDelivered
  | SettlerSpawned
  | WorkStarted
  | CropPlanted
  | CropHarvested
  | MineDepleted
  | SettlerRecruited
  | DonkeyBred;

/** Mutable per-tick event sink passed through the systems. */
export class EventSink {
  private readonly events: GameEvent[] = [];

  emit(e: GameEvent): void {
    this.events.push(e);
  }

  drain(): GameEvent[] {
    return this.events.slice();
  }
}
