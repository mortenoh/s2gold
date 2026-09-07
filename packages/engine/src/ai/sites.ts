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
  flagNodes: readonly number[] = playerFlagNodes(world, player),
): number {
  const flagNode = doorFlagNode(geom, node);
  const nearest = nearestFlag(geom, flagNodes, flagNode);
  if (nearest.dist > maxRoadLength) return -1;
  if (nearest.node < 0) return -1;
  if (findWalkPath(world, geom, rules, flagNode, nearest.node) === null) return -1;
  return nearest.dist;
}

/**
 * The player's flag nodes in id order. Site pickers scan hundreds of
 * candidates per decision; listing the flags once per pick instead of walking
 * the whole flag store per candidate is the difference between a big map
 * running at 50x and crawling (profiled on a 7-player 176x176 map).
 */
export function playerFlagNodes(world: World, player: number): number[] {
  const out: number[] = [];
  for (const f of storeLive(world.flags)) if (f.player === player) out.push(f.node);
  return out;
}

/** Nearest flag (node + distance) among `flagNodes`; lowest node on ties, -1 when none. */
function nearestFlag(
  geom: Geometry,
  flagNodes: readonly number[],
  node: number,
): { node: number; dist: number } {
  let best = -1;
  let bestDist = Infinity;
  for (const f of flagNodes) {
    const d = geom.distance(f, node);
    if (d < bestDist || (d === bestDist && (best < 0 || f < best))) {
      best = f;
      bestDist = d;
    }
  }
  return { node: best, dist: bestDist };
}

/** Nodes (bounded) matching `match` within `radius` of `center`, id-ascending. */
function objectNodesNear(
  geom: Geometry,
  center: number,
  radius: number,
  match: (node: number) => boolean,
): number[] {
  const out: number[] = [];
  geom.forEachNodeWithin(center, radius, (n) => {
    if (!match(n)) return;
    if (geom.distance(center, n) <= radius) out.push(n);
  });
  return out.sort((a, b) => a - b);
}

/**
 * Mask of every node within `radius` of any anchor (1 = near). Built once per
 * pick so the candidate loop is a lookup instead of an anchors-length distance
 * scan per candidate (trees run into the hundreds on a wooded map).
 */
function nearMask(geom: Geometry, anchors: readonly number[], radius: number): Uint8Array {
  // Multi-source breadth-first dilation: lattice-step depth IS the torus
  // distance, so depth <= radius marks exactly the nodes within the radius
  // without a single distance() call.
  const depth = new Int16Array(geom.size).fill(-1);
  let frontier: number[] = [];
  for (const a of anchors) {
    if (depth[a] < 0) {
      depth[a] = 0;
      frontier.push(a);
    }
  }
  const scratch = new Array<number>(6);
  for (let d = 0; d < radius && frontier.length > 0; d++) {
    const next: number[] = [];
    for (const n of frontier) {
      geom.neighboursInto(n, scratch);
      for (let i = 0; i < 6; i++) {
        const nb = scratch[i];
        if (depth[nb] < 0) {
          depth[nb] = d + 1;
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  const mask = new Uint8Array(geom.size);
  for (let n = 0; n < geom.size; n++) if (depth[n] >= 0) mask[n] = 1;
  return mask;
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
  let nearAnchor: Uint8Array | null = null;
  if (bias.kind === 'nearTrees') {
    const trees = objectNodesNear(geom, refNode, scanRadius + RADIUS.woodcutter, (n) =>
      isTreeType(world.objectType[n]),
    );
    if (trees.length === 0) return -1; // nowhere useful to fell
    nearAnchor = nearMask(geom, trees, RADIUS.woodcutter - 1);
  } else if (bias.kind === 'nearGranite') {
    const granites = objectNodesNear(geom, refNode, scanRadius + RADIUS.quarry, (n) =>
      isGraniteType(world.objectType[n]),
    );
    if (granites.length === 0) return -1;
    nearAnchor = nearMask(geom, granites, RADIUS.quarry - 1);
  }

  let bestNode = -1;
  let bestScore = Infinity;
  let bestSpacing = -Infinity;
  const flagNodes = playerFlagNodes(world, player);

  // Bounded window around the reference node (exact disc check inside); the
  // winner is tie-broken by node id, so visiting order does not matter.
  geom.forEachNodeWithin(refNode, scanRadius, (node) => {
    if (geom.distance(refNode, node) > scanRadius) return;
    if (!canPlaceBuilding(world, geom, rules, node, type, player)) return;

    // Bias-specific primary score (lower is better) and hard filters.
    let score: number;
    switch (bias.kind) {
      case 'nearHq':
        score = geom.distance(hq, node);
        break;
      case 'nearTrees':
        if (nearAnchor?.[node] !== 1) return;
        score = geom.distance(hq, node);
        break;
      case 'nearGranite':
        if (nearAnchor?.[node] !== 1) return;
        score = geom.distance(hq, node);
        break;
      case 'mine': {
        // Mines sit on the resource; require the subsurface nibble under the node.
        if (!terrainMineable(world, geom, node)) return;
        if (resourceType(world.resource[node]) !== bias.resource) return;
        if (resourceAmount(world.resource[node]) <= 0) return;
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
    const roadDist = siteRoadDistance(world, geom, rules, player, node, maxRoadLength, flagNodes);
    if (roadDist < 0) return;

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
  });
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
