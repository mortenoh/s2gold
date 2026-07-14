/**
 * Build-site selection for the AI (pure, deterministic, unit-testable).
 *
 * Every candidate is validated with the exact same {@link canPlaceBuilding} the
 * command layer uses (with the owning `player` so ownership is enforced) and must
 * be road-connectable within the AI's road-length budget, so a chosen site can
 * always be placed and wired. Scanning is bounded to a disc around a reference
 * node (economy: the HQ; frontier: the enemy) so no decision does a full-map
 * scan — CONSTANTS-scale maps stay cheap even though this runs every few ticks.
 *
 * Scoring is a lexicographic tuple resolved deterministically: primary bias
 * (proximity to a resource / to the HQ / toward the enemy), then a spacing bonus,
 * then the lowest node id — identical inputs always yield the identical site.
 */

import { canPlaceBuilding, terrainMineable } from '../commands';
import {
  buildingDef,
  isGraniteType,
  isTreeType,
  RADIUS,
  resourceAmount,
  resourceType,
  type BuildingType,
} from '../constants';
import type { Geometry } from '../geometry';
import { findWalkPath } from '../pathfinding';
import type { TerrainRules } from '../terrain';
import { storeLive, type World } from '../world';

/** How a site is scored relative to a reference point. */
export type SiteBias =
  | { kind: 'nearHq' }
  | { kind: 'nearTrees' }
  | { kind: 'nearGranite' }
  | { kind: 'mine'; resource: number }
  | { kind: 'frontier'; enemyNode: number }
  // Coast-directed expansion (seafaring.ts): grow territory toward `objective`, a
  // fixed coastal harbor-capable node on our own island. Scored exactly like
  // 'frontier' but aimed at the shore instead of an enemy, so each placed military
  // building steps the frontier toward the sea. Never a planner (enemy) goal.
  | { kind: 'coast'; objective: number };

/** The HQ node of a player, or -1 when it has none. */
export function hqNodeOf(world: World, player: number): number {
  const p = world.players[player];
  if (!p || p.hqBuildingId < 0) return -1;
  const hq = world.buildings.items[p.hqBuildingId];
  return hq ? hq.node : -1;
}

/** Door-flag node of a building node (SE neighbour), matching the engine rule. */
export function doorFlagNode(geom: Geometry, node: number): number {
  return geom.neighbour(node, 'SE');
}

/**
 * Road-connectivity budget for a candidate building `node`: the lattice distance
 * from its door flag to the nearest existing flag of `player`, or -1 when that
 * distance exceeds `maxRoadLength` or no walkable route to the nearest flag
 * exists. Shared by every AI site picker (economy, frontier, and harbor) so the
 * AI never commits to a road it cannot lay. Lower is nearer to the network.
 */
export function siteRoadDistance(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  player: number,
  node: number,
  maxRoadLength: number,
): number {
  const flagNode = doorFlagNode(geom, node);
  const roadDist = nearestPlayerFlagDistance(world, geom, player, flagNode);
  if (roadDist > maxRoadLength) return -1;
  if (!nearestFlagWalkable(world, geom, rules, player, flagNode)) return -1;
  return roadDist;
}

/** Distance from `node` to the nearest existing flag owned by `player` (Infinity if none). */
function nearestPlayerFlagDistance(
  world: World,
  geom: Geometry,
  player: number,
  node: number,
): number {
  let best = Infinity;
  for (const f of storeLive(world.flags)) {
    if (f.player !== player) continue;
    const d = geom.distance(f.node, node);
    if (d < best) best = d;
  }
  return best;
}

/** Nearest existing flag node owned by `player`, or -1. */
function nearestPlayerFlagNode(world: World, geom: Geometry, player: number, node: number): number {
  let best = -1;
  let bestDist = Infinity;
  for (const f of storeLive(world.flags)) {
    if (f.player !== player) continue;
    const d = geom.distance(f.node, node);
    if (d < bestDist || (d === bestDist && (best < 0 || f.node < best))) {
      best = f.node;
      bestDist = d;
    }
  }
  return best;
}

/** True when a road could plausibly be laid from `flagNode` to the nearest player flag. */
function nearestFlagWalkable(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  player: number,
  flagNode: number,
): boolean {
  const target = nearestPlayerFlagNode(world, geom, player, flagNode);
  if (target < 0) return false;
  return findWalkPath(world, geom, rules, flagNode, target) !== null;
}

/** Nodes (bounded) matching `match` within `radius` of `center`. */
function objectNodesNear(
  geom: Geometry,
  center: number,
  radius: number,
  match: (node: number) => boolean,
): number[] {
  const out: number[] = [];
  for (let n = 0; n < geom.size; n++) {
    if (!match(n)) continue;
    if (geom.distance(center, n) <= radius) out.push(n);
  }
  return out;
}

/** True when at least one node matching `match` lies within `radius` of `node`. */
function hasWithin(
  geom: Geometry,
  node: number,
  radius: number,
  targets: readonly number[],
): boolean {
  for (const t of targets) if (geom.distance(node, t) <= radius) return true;
  return false;
}

/**
 * Pick the best build site for `type` and `player` under a scoring `bias`, or -1.
 *
 * `refNode` centres the (bounded) candidate scan; `scanRadius` bounds it.
 * `maxRoadLength` caps how far the site may sit from the existing road network so
 * the AI never commits to an unlayable road.
 */
export function pickBuildSite(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  player: number,
  type: BuildingType,
  bias: SiteBias,
  refNode: number,
  scanRadius: number,
  maxRoadLength: number,
): number {
  if (refNode < 0) return -1;
  const hq = hqNodeOf(world, player);
  if (hq < 0) return -1;

  // Precompute the resource anchor list once (bounded to the scan disc).
  let trees: number[] = [];
  let granites: number[] = [];
  if (bias.kind === 'nearTrees') {
    trees = objectNodesNear(geom, refNode, scanRadius + RADIUS.woodcutter, (n) =>
      isTreeType(world.objectType[n]),
    );
    if (trees.length === 0) return -1; // nowhere useful to fell
  } else if (bias.kind === 'nearGranite') {
    granites = objectNodesNear(geom, refNode, scanRadius + RADIUS.quarry, (n) =>
      isGraniteType(world.objectType[n]),
    );
    if (granites.length === 0) return -1;
  }

  let bestNode = -1;
  let bestScore = Infinity;
  let bestSpacing = -Infinity;

  for (let node = 0; node < geom.size; node++) {
    if (geom.distance(refNode, node) > scanRadius) continue;
    if (!canPlaceBuilding(world, geom, rules, node, type, player)) continue;

    // Bias-specific primary score (lower is better) and hard filters.
    let score: number;
    switch (bias.kind) {
      case 'nearHq':
        score = geom.distance(hq, node);
        break;
      case 'nearTrees':
        if (!hasWithin(geom, node, RADIUS.woodcutter - 1, trees)) continue;
        score = geom.distance(hq, node);
        break;
      case 'nearGranite':
        if (!hasWithin(geom, node, RADIUS.quarry - 1, granites)) continue;
        score = geom.distance(hq, node);
        break;
      case 'mine': {
        // Mines sit on the resource; require the subsurface nibble under the node.
        if (!terrainMineable(world, geom, node)) continue;
        if (resourceType(world.resource[node]) !== bias.resource) continue;
        if (resourceAmount(world.resource[node]) <= 0) continue;
        // canPlaceBuilding already rejected any node not owned by us (neutral and
        // enemy alike), so a surviving mine candidate is guaranteed on our land.
        score = geom.distance(hq, node);
        break;
      }
      case 'frontier':
        score = geom.distance(bias.enemyNode, node);
        break;
      case 'coast':
        // Prefer the buildable frontier node nearest the objective shore, so the
        // military disc it will project reaches furthest toward the sea.
        score = geom.distance(bias.objective, node);
        break;
    }

    // Connectivity budget: the door flag must be within road reach of the network
    // and there must be a walkable route from it to the nearest existing flag.
    const roadDist = siteRoadDistance(world, geom, rules, player, node, maxRoadLength);
    if (roadDist < 0) continue;

    // Spacing bonus: prefer sites a little away from our own flags (tie-break).
    const spacing = roadDist;
    if (
      score < bestScore ||
      (score === bestScore && spacing > bestSpacing) ||
      (score === bestScore && spacing === bestSpacing && (bestNode < 0 || node < bestNode))
    ) {
      bestNode = node;
      bestScore = score;
      bestSpacing = spacing;
    }
  }
  return bestNode;
}

/** A reference node for the enemy: nearest enemy building to `player`'s HQ (-1 none). */
export function enemyReferenceNode(world: World, geom: Geometry, player: number): number {
  const hq = hqNodeOf(world, player);
  if (hq < 0) return -1;
  let best = -1;
  let bestDist = Infinity;
  for (const b of storeLive(world.buildings)) {
    if (b.player === player) continue;
    const def = buildingDef(b.type);
    if (!def) continue;
    const d = geom.distance(hq, b.node);
    if (d < bestDist || (d === bestDist && (best < 0 || b.node < best))) {
      best = b.node;
      bestDist = d;
    }
  }
  return best;
}
