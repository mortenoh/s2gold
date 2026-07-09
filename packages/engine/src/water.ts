/**
 * Water-node geometry for seafaring (P7).
 *
 * These helpers classify lattice nodes (not just texture bytes) for ship travel
 * and harbor placement, and provide the small graph queries the sea systems
 * share: which nodes are navigable water, the "dock" water node beside a harbor,
 * and whether a land node is coastal. Ship water-pathfinding lives in
 * pathfinding.ts (it reuses the shared A* min-heap); everything here is O(1) per
 * node and deterministic (fixed neighbour order, lowest-id tie-breaks).
 */

import type { Geometry } from './geometry';
import { isWaterTexture } from './terrain';
import type { World } from './world';

/**
 * True when a node is navigable water for a ship: both of its own texture layers
 * are water. Mirrors how {@link isWalkableTexture} gates a land node on its two
 * layers, so land/water classification uses the same node convention.
 */
export function isWaterNode(world: World, node: number): boolean {
  return isWaterTexture(world.terrain1[node]) && isWaterTexture(world.terrain2[node]);
}

/** The navigable-water neighbours of a node, in DIRECTIONS order. */
export function waterNeighbours(world: World, geom: Geometry, node: number): number[] {
  return geom.neighbours(node).filter((n) => isWaterNode(world, n));
}

/** Number of navigable-water neighbours a node has. */
export function waterNeighbourCount(world: World, geom: Geometry, node: number): number {
  let n = 0;
  for (const nb of geom.neighbours(node)) if (isWaterNode(world, nb)) n++;
  return n;
}

/** True when a land node touches at least one navigable-water node (coastal). */
export function isCoastalLand(world: World, geom: Geometry, node: number): boolean {
  return !isWaterNode(world, node) && waterNeighbourCount(world, geom, node) > 0;
}

/**
 * The water node a ship uses to dock at a harbor sitting on `harborNode`: the
 * lowest-id navigable-water neighbour, or -1 when the harbor is landlocked
 * (should not happen for a validly placed harbor).
 */
export function harborDockNode(world: World, geom: Geometry, harborNode: number): number {
  let best = -1;
  for (const nb of geom.neighbours(harborNode)) {
    if (isWaterNode(world, nb) && (best < 0 || nb < best)) best = nb;
  }
  return best;
}
