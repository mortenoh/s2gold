/**
 * AI seafaring: autonomous over-water expansion (the last land-locked gap).
 *
 * The land planner (planner.ts) expands until no military/economy site is
 * road-connectable within budget; on an island start that leaves the AI stalled
 * with a full economy and nowhere to grow. This module drives the existing
 * player-facing seafaring commands — placeBuilding(harbor/shipyard),
 * prepareExpedition, startExpedition — to found a harbor, build a ship, assemble
 * an expedition kit, and colonise a new landmass, using ONLY commands a human
 * could issue (the command layer validates every one).
 *
 * It is a stateless priority cascade over world state (like planNextBuilding):
 * each cycle it reads the player's sea assets and emits AT MOST ONE command,
 * self-correcting because a lost building/ship simply becomes the next goal
 * again. It is invoked by ai/index.ts only when the land planner produced nothing
 * this cycle (land expansion exhausted) and the player owns coastal territory.
 *
 * Determinism: every scan runs over ascending node ids and buildings/ships in id
 * order (storeLive), landmass ties break on the lowest node id, and it uses no
 * RNG — so the command stream replays identically for a given seed + map.
 */

import { canPlaceBuilding, canPlaceHarbor, type CommandInput } from '../commands';
import { BUILDING, OWNER_NONE, ownerPlayer } from '../constants';
import type { Geometry } from '../geometry';
import { findWaterPath } from '../pathfinding';
import { hasHarborFlag, type TerrainRules } from '../terrain';
import { harborDockNode, isCoastalLand, isWaterNode } from '../water';
import { storeLive, type Building, type Ship, type World } from '../world';
import { flagsConnectedToHq } from './roads';
import { hqNodeOf, siteRoadDistance } from './sites';
import type { AiState } from './types';

/** Connected-component labelling of the lattice under a membership predicate. */
interface Components {
  /** Component id per node, or -1 for non-member nodes. */
  comp: Int32Array;
  /** Node count of each component, indexed by component id. */
  size: number[];
}

/**
 * Label the connected components of the nodes matching `isMember` over the
 * (6-neighbour) lattice. Water uses the same adjacency findWaterPath sails, and
 * land uses the same adjacency an island forms, so "same water component" is
 * exactly "a ship can sail between them" and "different land component" is
 * exactly "a genuine sea crossing". One flood per component, O(size) overall.
 */
function labelComponents(geom: Geometry, isMember: (node: number) => boolean): Components {
  const comp = new Int32Array(geom.size).fill(-1);
  const size: number[] = [];
  for (let start = 0; start < geom.size; start++) {
    if (comp[start] >= 0 || !isMember(start)) continue;
    const id = size.length;
    let count = 0;
    const stack = [start];
    comp[start] = id;
    while (stack.length > 0) {
      const cur = stack.pop() as number;
      count++;
      for (const nb of geom.neighbours(cur)) {
        if (comp[nb] < 0 && isMember(nb)) {
          comp[nb] = id;
          stack.push(nb);
        }
      }
    }
    size.push(count);
  }
  return { comp, size };
}

/**
 * The expedition-landing spot checks, mirrored from systems/seafaring's private
 * `expeditionSpotFree`: a colonisation target must be a free land node whose SE
 * door node is free and whose door flag (if any) is our own — the same gate
 * execStartExpedition re-applies, so a target the AI picks is one it can found.
 */
function spotFree(world: World, geom: Geometry, node: number, player: number): boolean {
  if (world.buildingAtNode[node] >= 0) return false;
  const doorNode = geom.neighbour(node, 'SE');
  if (world.buildingAtNode[doorNode] >= 0) return false;
  const doorFlag = world.flagAtNode[doorNode];
  if (doorFlag >= 0 && world.flags.items[doorFlag]?.player !== player) return false;
  return true;
}

/**
 * Precomputed sea picture for a cycle: water + land components and the current
 * colonisation targets (unowned, foundable coastal land nodes). Built at most
 * once per seafaring cycle and only when a founding/launch decision needs it.
 */
interface SeaMap {
  water: Components;
  land: Components;
  /** Candidate colonisation spots: unowned foundable coastal land, id-ascending. */
  targets: number[];
}

function analyzeSea(world: World, geom: Geometry, player: number): SeaMap {
  const water = labelComponents(geom, (n) => isWaterNode(world, n));
  const land = labelComponents(geom, (n) => !isWaterNode(world, n));
  const targets: number[] = [];
  for (let n = 0; n < geom.size; n++) {
    if (isWaterNode(world, n)) continue;
    if (world.owner[n] !== OWNER_NONE) continue; // must be unclaimed by anyone
    if (!isCoastalLand(world, geom, n)) continue;
    if (!spotFree(world, geom, n, player)) continue;
    targets.push(n);
  }
  return { water, land, targets };
}

/**
 * The best colonisation target reachable by sea from `harborNode`, or -1.
 *
 * A target must sit in the same WATER component as the harbor's dock (so a ship
 * can sail there) and on a DIFFERENT LAND component (a real over-water crossing,
 * never a spot on our own island). Among those we prefer the largest destination
 * landmass (most room to grow the new colony), breaking ties by nearest dock
 * distance and then the lowest node id — fully deterministic.
 */
function pickTarget(world: World, geom: Geometry, sea: SeaMap, harborNode: number): number {
  const dock = harborDockNode(world, geom, harborNode);
  if (dock < 0) return -1;
  const seaComp = sea.water.comp[dock];
  const homeLand = sea.land.comp[harborNode];
  let best = -1;
  let bestSize = -1;
  let bestDist = Infinity;
  for (const t of sea.targets) {
    if (sea.land.comp[t] === homeLand) continue; // same island: not a sea crossing
    const tDock = harborDockNode(world, geom, t);
    if (tDock < 0 || sea.water.comp[tDock] !== seaComp) continue; // unreachable by this sea
    const size = sea.land.size[sea.land.comp[t]] ?? 0;
    const dist = geom.distance(dock, t);
    if (
      size > bestSize ||
      (size === bestSize && dist < bestDist) ||
      (size === bestSize && dist === bestDist && (best < 0 || t < best))
    ) {
      best = t;
      bestSize = size;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Pick a coastal harbor site inside our territory, connectable to the road
 * network within budget, from which the sea reaches a colonisation target.
 *
 * Site scoring (lexicographic, deterministic): explicit map harbor spots
 * (HARBOR_TEXTURE_FLAG) first — map authors mark the intended embarkation points;
 * then nearest to the HQ (short supply road for the kit); then the lowest node
 * id. Only sites that actually open a sea crossing to unowned land are eligible,
 * so the AI never founds a useless landlocked-lake harbor.
 */
function pickHarborSite(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  sea: SeaMap,
  player: number,
  hq: number,
  maxRoadLength: number,
): number {
  let best = -1;
  let bestFlagged = false;
  let bestDist = Infinity;
  for (let n = 0; n < geom.size; n++) {
    if (!isCoastalLand(world, geom, n)) continue;
    if (!canPlaceHarbor(world, geom, rules, n, player)) continue; // own land + free door
    if (siteRoadDistance(world, geom, rules, player, n, maxRoadLength) < 0) continue;
    if (pickTarget(world, geom, sea, n) < 0) continue; // must open a real sea crossing
    const flagged = hasHarborFlag(world.terrain1[n]) || hasHarborFlag(world.terrain2[n]);
    const dist = geom.distance(hq, n);
    if (
      (flagged && !bestFlagged) ||
      (flagged === bestFlagged && dist < bestDist) ||
      (flagged === bestFlagged && dist === bestDist && (best < 0 || n < best))
    ) {
      best = n;
      bestFlagged = flagged;
      bestDist = dist;
    }
  }
  return best;
}

/** A coastal shipyard site connectable to the network, nearest a working harbor. */
function pickShipyardSite(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  player: number,
  harbor: Building,
  maxRoadLength: number,
): number {
  let best = -1;
  let bestDist = Infinity;
  for (let n = 0; n < geom.size; n++) {
    if (!isCoastalLand(world, geom, n)) continue;
    if (!canPlaceBuilding(world, geom, rules, n, BUILDING.shipyard, player)) continue;
    if (siteRoadDistance(world, geom, rules, player, n, maxRoadLength) < 0) continue;
    const dist = geom.distance(harbor.node, n);
    if (dist < bestDist || (dist === bestDist && (best < 0 || n < best))) {
      best = n;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * One seafaring decision for `player`, or null when there is nothing to do (no
 * coast, no reachable unowned land, or waiting on the economy/a voyage). Emits at
 * most one command; the priority cascade both drives the expedition forward and
 * self-heals a lost step.
 */
export function planSeafaring(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  state: AiState,
): CommandInput | null {
  const player = state.playerId;
  const hq = hqNodeOf(world, player);
  if (hq < 0) return null;

  // --- Inventory this player's sea assets (id order for determinism). --------
  const workingHarbors: Building[] = [];
  let harborSite = false;
  let shipyard = false; // working or under construction
  for (const b of storeLive(world.buildings)) {
    if (b.player !== player) continue;
    if (b.type === BUILDING.harbor && b.state === 'working') workingHarbors.push(b);
    else if (b.type === BUILDING.harbor && b.state === 'site') harborSite = true;
    else if (b.type === BUILDING.shipyard) shipyard = true;
  }
  let shipCount = 0;
  let shipOnExpedition = false;
  const idleShipHomes = new Set<number>();
  for (const s of storeLive(world.ships)) {
    if (s.player !== player) continue;
    shipCount++;
    if (s.state === 'expedition') shipOnExpedition = true;
    else if (s.state === 'idle' && s.cargo.length === 0) idleShipHomes.add(s.homeHarborId);
  }
  const readyExp = world.expeditions.find((e) => e.player === player && e.ready);
  const preparingExp = world.expeditions.find((e) => e.player === player && !e.ready);

  // Cheap gate before any component labelling: if we hold no sea asset yet, only
  // bother analysing the sea when we actually own coast. On a land map (or before
  // the frontier reaches the shore) this is a single early-outing scan and the
  // costly analyzeSea never runs. Once seafaring is under way the asset checks
  // above already prove we are on a sea map, so the guard is skipped.
  const seafaring =
    workingHarbors.length > 0 ||
    harborSite ||
    shipyard ||
    shipCount > 0 ||
    !!readyExp ||
    !!preparingExp;
  if (!seafaring && !ownsCoast(world, geom, player)) return null;

  // 1. Launch a ready expedition: pick a fresh sea target each cycle (so a spot
  //    claimed during assembly is abandoned for another), validate the water
  //    route the way execStartExpedition will, and sail. A ready kit with no
  //    valid target waits (returns null) and retries next cycle.
  if (readyExp) {
    const harbor = world.buildings.items[readyExp.harborId];
    if (harbor && harbor.state === 'working' && idleShipHomes.has(harbor.id)) {
      const sea = analyzeSea(world, geom, player);
      const target = pickTarget(world, geom, sea, harbor.node);
      if (target >= 0) {
        const ship = idleHomedShip(world, harbor.id);
        const targetDock = harborDockNode(world, geom, target);
        if (ship && targetDock >= 0 && findWaterPath(world, geom, ship.node, targetDock)) {
          return { player, type: 'startExpedition', harborId: harbor.id, targetSpot: target };
        }
      }
    }
    return null; // ready but not launchable yet — hold the kit, retry next cycle
  }

  // 2. An expedition is still assembling its kit: wait (the demand-driven
  //    transport delivers boards/stones to the harbor over roads).
  if (preparingExp) return null;

  // 3. Found the first harbor when we have none (and none under construction).
  //    Self-heals a razed harbor. Only sites that open a real sea crossing to
  //    unowned land are eligible, so this also gates the whole feature: no
  //    reachable target -> no harbor -> planSeafaring stays a no-op.
  if (workingHarbors.length === 0 && !harborSite) {
    const sea = analyzeSea(world, geom, player);
    if (sea.targets.length === 0) return null;
    const node = pickHarborSite(world, geom, rules, sea, player, hq, state.maxRoadLength);
    if (node < 0) return null; // no owned, connectable, target-facing coast yet
    return { player, type: 'placeBuilding', node, buildingType: BUILDING.harbor };
  }

  // 4. Build a shipyard to produce our one ship (kept to a single yard/ship: one
  //    ship serves the capped-at-1 expedition). The normal economy feeds it
  //    boards as an ordinary input; it spawns the ship docked at a harbor.
  if (workingHarbors.length >= 1 && shipCount === 0 && !shipyard && !shipOnExpedition) {
    const node = pickShipyardSite(
      world,
      geom,
      rules,
      player,
      workingHarbors[0],
      state.maxRoadLength,
    );
    if (node < 0) return null;
    return { player, type: 'placeBuilding', node, buildingType: BUILDING.shipyard };
  }

  // 5. Prepare an expedition once a ship is idle at a harbor that (a) is wired to
  //    the HQ warehouse network — so the kit is deliverable by road — and (b) can
  //    reach an unowned landmass by sea. Capped at one concurrent expedition by
  //    the readyExp/preparingExp guards above.
  if (shipCount >= 1 && !shipOnExpedition) {
    const connected = flagsConnectedToHq(world, player);
    const sea = analyzeSea(world, geom, player);
    for (const harbor of workingHarbors) {
      if (!idleShipHomes.has(harbor.id)) continue;
      if (!connected.has(harbor.flagId)) continue; // kit must be road-deliverable
      if (pickTarget(world, geom, sea, harbor.node) < 0) continue;
      return { player, type: 'prepareExpedition', harborId: harbor.id };
    }
  }

  return null;
}

/** The first idle, empty ship homed at `harborId` (id order), or null. */
function idleHomedShip(world: World, harborId: number): Ship | null {
  for (const s of storeLive(world.ships)) {
    if (s.homeHarborId === harborId && s.state === 'idle' && s.cargo.length === 0) return s;
  }
  return null;
}

/** True when `player` owns at least one coastal land node (early-outs on the first). */
function ownsCoast(world: World, geom: Geometry, player: number): boolean {
  for (let n = 0; n < geom.size; n++) {
    if (ownerPlayer(world.owner[n]) !== player) continue;
    if (isWaterNode(world, n)) continue;
    if (isCoastalLand(world, geom, n)) return true;
  }
  return false;
}
