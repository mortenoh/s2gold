/**
 * The AI build planner: a fixed, priority-ordered goal list resolved against the
 * current world each cycle (so it self-corrects — a lost building simply becomes
 * the next goal again). Phases are implicit in the ordering:
 *
 *   1. Bootstrap economy near the HQ: woodcutter -> sawmill -> quarry -> forester
 *      (plank + stone supply, and a forester so wood does not run out).
 *   2. Expand: interleave frontier military buildings (to claim land and press the
 *      enemy) with more wood and the food chain (well/farm/mill/bakery).
 *   3. Deepen: mines on owned mountains once food can feed them, then the metal
 *      chain (smelter/armory/metalworks/mint).
 *
 * Each entry names a cumulative target count for its building type; the planner
 * builds the first entry whose type is still below its target and for which a
 * valid, connectable site exists, returning at most one placement per cycle.
 */

import type { CommandInput } from '../commands';
import { BUILDING, buildingDef, RESOURCE, type BuildingType } from '../constants';
import type { Geometry } from '../geometry';
import type { TerrainRules } from '../terrain';
import { storeLive, type World } from '../world';
import { enemyReferenceNode, hqNodeOf, pickBuildSite, type SiteBias } from './sites';
import type { AiState } from './types';

/** One planner goal: reach `count` of `type`, choosing sites by `bias`. */
interface Goal {
  type: BuildingType;
  count: number;
  bias: SiteBias['kind'];
  /** Mine resource nibble (only for mine goals). */
  resource?: number;
}

/** How far from the reference node each bias scans for candidate sites. */
const ECONOMY_SCAN_RADIUS = 16;
const FRONTIER_SCAN_RADIUS = 24;

/** The ordered build plan (cumulative counts per type). */
const PLAN: readonly Goal[] = [
  { type: BUILDING.woodcutter, count: 1, bias: 'nearTrees' },
  { type: BUILDING.sawmill, count: 1, bias: 'nearHq' },
  { type: BUILDING.quarry, count: 1, bias: 'nearGranite' },
  { type: BUILDING.forester, count: 1, bias: 'nearTrees' },
  { type: BUILDING.guardhouse, count: 1, bias: 'frontier' },
  { type: BUILDING.woodcutter, count: 2, bias: 'nearTrees' },
  { type: BUILDING.guardhouse, count: 2, bias: 'frontier' },
  { type: BUILDING.sawmill, count: 2, bias: 'nearHq' },
  { type: BUILDING.forester, count: 2, bias: 'nearTrees' },
  { type: BUILDING.farm, count: 1, bias: 'nearHq' },
  { type: BUILDING.guardhouse, count: 3, bias: 'frontier' },
  { type: BUILDING.mill, count: 1, bias: 'nearHq' },
  // The well goes up only once the bakery is imminent: a well is a generator
  // producing water continuously, and with no consumer yet every bucket would
  // flood the road network toward the HQ (pure congestion).
  { type: BUILDING.well, count: 1, bias: 'nearHq' },
  { type: BUILDING.bakery, count: 1, bias: 'nearHq' },
  { type: BUILDING.quarry, count: 2, bias: 'nearGranite' },
  { type: BUILDING.coalmine, count: 1, bias: 'mine', resource: RESOURCE.coal },
  { type: BUILDING.ironmine, count: 1, bias: 'mine', resource: RESOURCE.iron },
  { type: BUILDING.goldmine, count: 1, bias: 'mine', resource: RESOURCE.gold },
  { type: BUILDING.ironsmelter, count: 1, bias: 'nearHq' },
  { type: BUILDING.brewery, count: 1, bias: 'nearHq' },
  { type: BUILDING.armory, count: 1, bias: 'nearHq' },
  { type: BUILDING.metalworks, count: 1, bias: 'nearHq' },
  { type: BUILDING.mint, count: 1, bias: 'nearHq' },
  // Catapults: frontier area denial once the economy is deep. They are kind
  // 'catapult' (not military), so the maxMilitary cap does not stop them, and
  // they fire automatically as long as dispatch keeps stones coming.
  { type: BUILDING.catapult, count: 1, bias: 'frontier' },
  { type: BUILDING.guardhouse, count: 4, bias: 'frontier' },
  { type: BUILDING.catapult, count: 2, bias: 'frontier' },
];

/** Current number of a building type owned by `player` (sites + working). */
function countType(world: World, player: number, type: BuildingType): number {
  let n = 0;
  for (const b of storeLive(world.buildings)) {
    if (b.player === player && b.type === type) n++;
  }
  return n;
}

/** Total military buildings (sites + working) owned by `player`. */
export function militaryCount(world: World, player: number): number {
  let n = 0;
  for (const b of storeLive(world.buildings)) {
    if (b.player === player && buildingDef(b.type)?.kind === 'military') n++;
  }
  return n;
}

/** Resolve a goal's bias into a concrete {@link SiteBias} for this world. */
function resolveBias(world: World, geom: Geometry, player: number, goal: Goal): SiteBias | null {
  switch (goal.bias) {
    case 'nearHq':
      return { kind: 'nearHq' };
    case 'nearTrees':
      return { kind: 'nearTrees' };
    case 'nearGranite':
      return { kind: 'nearGranite' };
    case 'mine':
      return { kind: 'mine', resource: goal.resource ?? 0 };
    case 'frontier': {
      const enemyNode = enemyReferenceNode(world, geom, player);
      return enemyNode < 0 ? null : { kind: 'frontier', enemyNode };
    }
    // Coast-directed expansion is driven by seafaring.ts (which owns the sea
    // analysis needed to locate the objective shore), never a fixed planner goal.
    case 'coast':
      return null;
  }
}

/**
 * Pick this cycle's placement command, or null. Walks the plan and builds the
 * first unmet goal with a valid, connectable site. `maxMilitary` caps frontier
 * military so the AI does not sprawl endlessly.
 */
export function planNextBuilding(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  state: AiState,
): CommandInput | null {
  const player = state.playerId;
  const hq = hqNodeOf(world, player);
  if (hq < 0) return null;

  for (const goal of PLAN) {
    if (countType(world, player, goal.type) >= goal.count) continue;
    const isMilitary = buildingDef(goal.type)?.kind === 'military';
    if (isMilitary && militaryCount(world, player) >= state.maxMilitary) continue;

    const bias = resolveBias(world, geom, player, goal);
    if (!bias) continue;

    const isFrontier = bias.kind === 'frontier';
    const refNode = isFrontier ? bias.enemyNode : hq;
    const scanRadius = isFrontier ? FRONTIER_SCAN_RADIUS : ECONOMY_SCAN_RADIUS;
    const node = pickBuildSite(
      world,
      geom,
      rules,
      player,
      goal.type,
      bias,
      refNode,
      scanRadius,
      state.maxRoadLength,
    );
    if (node < 0) continue;
    return { player, type: 'placeBuilding', node, buildingType: goal.type };
  }
  return null;
}
