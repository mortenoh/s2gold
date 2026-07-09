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

/** A new Private was recruited from beer+sword+shield+helper (MILITARY.md §6). */
export interface SoldierRecruited {
  type: 'SoldierRecruited';
  player: number;
}

/** A soldier occupied a military building for the first/next time (MILITARY.md §3). */
export interface MilitaryOccupied {
  type: 'MilitaryOccupied';
  buildingId: number;
  rank: number;
  player: number;
  /** True when this was the building's first occupant (territory activates). */
  firstOccupant: boolean;
}

/** Ownership/borders changed after a RecalcTerritory (MILITARY.md §3). */
export interface TerritoryChanged {
  type: 'TerritoryChanged';
  player: number;
}

/** A one-on-one duel began at a building flag (MILITARY.md §5). */
export interface FightStarted {
  type: 'FightStarted';
  node: number;
  attackerPlayer: number;
  attackerRank: number;
  defenderPlayer: number;
  defenderRank: number;
}

/** A soldier lost all hitpoints and died (MILITARY.md §5). */
export interface SoldierDied {
  type: 'SoldierDied';
  node: number;
  player: number;
  rank: number;
}

/** A military building changed hands (MILITARY.md §4). `burned` = HQ razed. */
export interface BuildingCaptured {
  type: 'BuildingCaptured';
  buildingId: number;
  buildingType: BuildingType;
  node: number;
  fromPlayer: number;
  toPlayer: number;
  burned: boolean;
}

/** A gold coin promoted soldiers in a building (MILITARY.md §6). */
export interface SoldierPromoted {
  type: 'SoldierPromoted';
  buildingId: number;
  player: number;
  /** Number of soldiers raised one rank in this wave. */
  count: number;
}

/** A catapult threw a stone at an enemy military building (MILITARY.md §7). */
export interface CatapultFired {
  type: 'CatapultFired';
  buildingId: number;
  targetBuildingId: number;
  player: number;
  hit: boolean;
}

// --- Seafaring (P7) --------------------------------------------------------

/** A shipyard finished building a ship; it now docks at `homeHarborId`. */
export interface ShipBuilt {
  type: 'ShipBuilt';
  shipId: number;
  buildingId: number;
  homeHarborId: number;
  player: number;
}

/** A harbor finished assembling an expedition kit (boards + stones + builder). */
export interface ExpeditionReady {
  type: 'ExpeditionReady';
  harborId: number;
  player: number;
}

/** An expedition ship reached its target spot and founded a new harbor. */
export interface ExpeditionLanded {
  type: 'ExpeditionLanded';
  shipId: number;
  harborId: number;
  node: number;
  player: number;
}

/** A ship arrived at a harbor dock (delivered cargo / returned home / landed). */
export interface ShipArrived {
  type: 'ShipArrived';
  shipId: number;
  harborId: number;
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
  | DonkeyBred
  | SoldierRecruited
  | MilitaryOccupied
  | TerritoryChanged
  | FightStarted
  | SoldierDied
  | BuildingCaptured
  | SoldierPromoted
  | CatapultFired
  | ShipBuilt
  | ExpeditionReady
  | ExpeditionLanded
  | ShipArrived;

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
