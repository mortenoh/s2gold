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
  | SettlerSpawned;

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
