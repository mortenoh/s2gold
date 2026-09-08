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
import { storeLive, warehouseTotals, type World } from '../world';
import {
  enemyReferenceNode,
  hqNodeOf,
  pickBuildSite,
  type SiteBias,
  ownedNodeNearest,
} from './sites';
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
/** How long an unplaceable goal rests before its site scan is retried. */
const GOAL_RETRY_TICKS = 600;
const FRONTIER_SCAN_RADIUS = 24;

/** The ordered build plan (cumulative counts per type). */
const PLAN: readonly Goal[] = [
  // Military steps are interleaved with the economy from the start: the
  // original AI pushes its border continuously, and every occupied building
  // both claims land and banks the soldier surplus that attacks are made of.
  // Coal, iron and the metalworks come BEFORE the armory: the HQ's starting
  // ore and coal are the only iron until the mines run, and tools (pick-axes
  // for the miners above all) must be made from it before swords are, or the
  // whole metal chain deadlocks (measured: 4 swords in 100k ticks, then nothing).
  { type: BUILDING.woodcutter, count: 1, bias: 'nearTrees' },
  { type: BUILDING.sawmill, count: 1, bias: 'nearHq' },
  { type: BUILDING.quarry, count: 1, bias: 'nearGranite' },
  { type: BUILDING.forester, count: 1, bias: 'nearTrees' },
  { type: BUILDING.guardhouse, count: 1, bias: 'frontier' },
  { type: BUILDING.woodcutter, count: 2, bias: 'nearTrees' },
  { type: BUILDING.guardhouse, count: 2, bias: 'frontier' },
  { type: BUILDING.sawmill, count: 2, bias: 'nearHq' },
  { type: BUILDING.forester, count: 2, bias: 'nearTrees' },
  { type: BUILDING.guardhouse, count: 3, bias: 'frontier' },
  { type: BUILDING.farm, count: 1, bias: 'nearHq' },
  { type: BUILDING.hunter, count: 1, bias: 'nearHq' },
  { type: BUILDING.guardhouse, count: 4, bias: 'frontier' },
  { type: BUILDING.mill, count: 1, bias: 'nearHq' },
  { type: BUILDING.well, count: 1, bias: 'nearHq' },
  { type: BUILDING.watchtower, count: 1, bias: 'frontier' },
  { type: BUILDING.bakery, count: 1, bias: 'nearHq' },
  { type: BUILDING.coalmine, count: 1, bias: 'mine', resource: RESOURCE.coal },
  { type: BUILDING.ironmine, count: 1, bias: 'mine', resource: RESOURCE.iron },
  { type: BUILDING.ironsmelter, count: 1, bias: 'nearHq' },
  { type: BUILDING.metalworks, count: 1, bias: 'nearHq' },
  { type: BUILDING.guardhouse, count: 5, bias: 'frontier' },
  { type: BUILDING.quarry, count: 2, bias: 'nearGranite' },
  // Quarries exhaust their granite piles; without a granite mine the stone
  // supply dies and every later site (and the whole expansion) stalls.
  { type: BUILDING.granitemine, count: 1, bias: 'mine', resource: RESOURCE.granite },
  // Smelter, armory and mint all burn coal: one mine starves the weapon chain.
  { type: BUILDING.coalmine, count: 2, bias: 'mine', resource: RESOURCE.coal },
  { type: BUILDING.brewery, count: 1, bias: 'nearHq' },
  { type: BUILDING.armory, count: 1, bias: 'nearHq' },
  { type: BUILDING.guardhouse, count: 6, bias: 'frontier' },
  { type: BUILDING.quarry, count: 3, bias: 'nearGranite' },
  { type: BUILDING.goldmine, count: 1, bias: 'mine', resource: RESOURCE.gold },
  { type: BUILDING.watchtower, count: 2, bias: 'frontier' },
  { type: BUILDING.guardhouse, count: 7, bias: 'frontier' },
  { type: BUILDING.mint, count: 1, bias: 'nearHq' },
  { type: BUILDING.quarry, count: 4, bias: 'nearGranite' },
  { type: BUILDING.fortress, count: 1, bias: 'frontier' },
  // Catapults: frontier area denial once the economy is deep. They are kind
  // 'catapult' (not military), so the maxMilitary cap does not stop them, and
  // they fire automatically as long as dispatch keeps stones coming.
  { type: BUILDING.catapult, count: 1, bias: 'frontier' },
  { type: BUILDING.guardhouse, count: 8, bias: 'frontier' },
  { type: BUILDING.catapult, count: 2, bias: 'frontier' },
];

/**
 * Open-ended frontier expansion once the fixed plan is met: like the original
 * AI, keep stepping the border toward the nearest rival until the military cap
 * or the land runs out. Bigger buildings every few steps hold more soldiers,
 * which is what an attack's surplus comes from.
 */
function expansionType(militaryCount: number, stone: number): BuildingType {
  // Stone-poor (quarries exhausted, no granite in reach): barracks cost no
  // stone at all, so the border keeps moving instead of waiting forever.
  if (stone < 3) return BUILDING.barracks;
  if (militaryCount % 6 === 5 && stone >= 7) return BUILDING.fortress;
  if (militaryCount % 3 === 2 && stone >= 5) return BUILDING.watchtower;
  return BUILDING.guardhouse;
}

/**
 * Only raise a military building the reserve can fill: every occupied building
 * drains idle soldiers, and a settlement that spreads 46 privates over twenty
 * huts has nobody left to attack with (measured: the AI hit its cap with seven
 * empty buildings and never fought). Waiting for recruits keeps garrisons full
 * where the frontier is.
 */
function canGarrison(world: World, player: number, type: BuildingType): boolean {
  const need = buildingDef(type)?.maxTroops ?? 1;
  const pl = world.players[player];
  if (!pl) return false;
  let reserve = 0;
  for (const n of pl.soldiers) reserve += n;
  // Recruits in the making count too: a sword, a shield and a beer in stock
  // become a private (recruitment never stops while the stock lasts), and the
  // reserve alone reads zero whenever occupation drains it as fast as it fills.
  const w = warehouseTotals(world, player);
  const pending = Math.min(w.sword ?? 0, w.shield ?? 0, w.beer ?? 0);
  return reserve + pending >= need;
}

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

  for (let gi = 0; gi < PLAN.length; gi++) {
    const goal = PLAN[gi];
    if (countType(world, player, goal.type) >= goal.count) continue;
    const isMilitary = buildingDef(goal.type)?.kind === 'military';
    if (isMilitary && militaryCount(world, player) >= state.maxMilitary) continue;
    if (isMilitary && !canGarrison(world, player, goal.type)) continue;
    // A goal that found no site recently is skipped for a while (deterministic).
    // (`??=`: AI state restored from an older save lacks the table.)
    if (((state.goalRetryTick ??= {})[gi] ?? 0) > world.tick) continue;

    const bias = resolveBias(world, geom, player, goal);
    if (!bias) continue;

    // Frontier: scan OUR land nearest the enemy (the window must contain nodes
    // we can build on), scored by closeness to the enemy. Centring on the enemy
    // itself left every guardhouse goal unplaceable whenever rivals started more
    // than a scan radius apart, so the AI never expanded and never fought.
    const isFrontier = bias.kind === 'frontier';
    const refNode = isFrontier ? ownedNodeNearest(world, geom, player, bias.enemyNode) : hq;
    if (refNode < 0) continue;
    // Stone and ore sit where the map put them, not near the HQ: quarries and
    // mines search the whole grown territory, other workshops stay compact.
    const wide = isFrontier || bias.kind === 'nearGranite' || bias.kind === 'mine';
    const scanRadius = wide ? FRONTIER_SCAN_RADIUS : ECONOMY_SCAN_RADIUS;
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
    if (node < 0) {
      state.goalRetryTick[gi] = world.tick + GOAL_RETRY_TICKS;
      continue;
    }
    return { player, type: 'placeBuilding', node, buildingType: goal.type };
  }

  // Plan complete: keep expanding toward the enemy while the cap allows.
  const owned = militaryCount(world, player);
  if (owned < state.maxMilitary) {
    const bias = resolveBias(world, geom, player, {
      type: BUILDING.guardhouse,
      count: 0,
      bias: 'frontier',
    });
    if (bias && bias.kind === 'frontier') {
      const type = expansionType(owned, warehouseTotals(world, player).stone ?? 0);
      if (!canGarrison(world, player, type)) return null;
      const center = ownedNodeNearest(world, geom, player, bias.enemyNode);
      if (center < 0) return null;
      const node = pickBuildSite(
        world,
        geom,
        rules,
        player,
        type,
        bias,
        center,
        FRONTIER_SCAN_RADIUS,
        state.maxRoadLength,
      );
      if (node >= 0) return { player, type: 'placeBuilding', node, buildingType: type };
    }
  }
  return null;
}
