/**
 * Deterministic A* pathfinding.
 *
 * Two graphs are supported:
 *  - the road network (flags as nodes, roads as weighted edges) for ware
 *    routing flag-to-flag, and
 *  - the terrain lattice for free-walking settlers, honouring impassable
 *    terrain (water / swamp / snow / lava, parameterized via TerrainRules).
 *
 * All tie-breaking is by ascending node/flag id so results are identical across
 * runs and platforms.
 */

import { ownerPlayer } from './constants';
import type { Geometry } from './geometry';
import { isWalkableTexture, type TerrainRules } from './terrain';
import { isWaterNode } from './water';
import { getFlag, getRoad, storeLive, type World } from './world';

/** A binary min-heap of (id) ordered by (priority, id) for deterministic pops. */
class MinHeap {
  private readonly ids: number[] = [];
  private readonly prio: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  private less(a: number, b: number): boolean {
    if (this.prio[a] !== this.prio[b]) return this.prio[a] < this.prio[b];
    return this.ids[a] < this.ids[b];
  }

  push(id: number, priority: number): void {
    this.ids.push(id);
    this.prio.push(priority);
    let i = this.ids.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.less(i, parent)) {
        this.swap(i, parent);
        i = parent;
      } else break;
    }
  }

  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop() as number;
    const lastPrio = this.prio.pop() as number;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.prio[0] = lastPrio;
      let i = 0;
      const n = this.ids.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < n && this.less(l, smallest)) smallest = l;
        if (r < n && this.less(r, smallest)) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const ti = this.ids[a];
    this.ids[a] = this.ids[b];
    this.ids[b] = ti;
    const tp = this.prio[a];
    this.prio[a] = this.prio[b];
    this.prio[b] = tp;
  }
}

/** Reconstruct a path from a came-from map. */
function rebuild(cameFrom: Map<number, number>, goal: number): number[] {
  const path = [goal];
  let cur = goal;
  while (cameFrom.has(cur)) {
    cur = cameFrom.get(cur) as number;
    path.push(cur);
  }
  path.reverse();
  return path;
}

/**
 * Free-walk A* on the terrain lattice from `start` to `goal`.
 *
 * Returns the node sequence EXCLUDING `start` and INCLUDING `goal`, or null if
 * unreachable. Building nodes block movement (except the goal itself); flags and
 * roads are walkable. Pass `blockFlags` to also route around interior flags —
 * used to plan a *road* (which cannot pass through another flag), so the planned
 * path is one the buildRoad command will actually accept. Pass `ownedBy` to
 * confine the whole path to that player's territory — a planned road may never
 * cross neutral or enemy land (execBuildRoad rejects it), so an owned route must
 * be found instead. Left undefined (the default), ownership is not constrained.
 */
export function findWalkPath(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  start: number,
  goal: number,
  blockFlags = false,
  ownedBy?: number,
): number[] | null {
  if (start === goal) return [];

  const walkable = (n: number): boolean => {
    if (n !== goal && world.buildingAtNode[n] >= 0) return false;
    if (blockFlags && n !== goal && world.flagAtNode[n] >= 0) return false;
    if (ownedBy !== undefined && ownerPlayer(world.owner[n]) !== ownedBy) return false;
    return (
      isWalkableTexture(world.terrain1[n], rules) && isWalkableTexture(world.terrain2[n], rules)
    );
  };
  if (!walkable(goal)) return null;

  const open = new MinHeap();
  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  gScore.set(start, 0);
  open.push(start, geom.distance(start, goal));

  const closed = new Set<number>();
  while (open.size > 0) {
    const cur = open.pop();
    if (cur === goal) return rebuild(cameFrom, goal).slice(1);
    if (closed.has(cur)) continue;
    closed.add(cur);
    const curG = gScore.get(cur) as number;
    for (const nb of geom.neighbours(cur)) {
      if (closed.has(nb) || !walkable(nb)) continue;
      const tentative = curG + 1;
      const known = gScore.get(nb);
      if (known === undefined || tentative < known) {
        gScore.set(nb, tentative);
        cameFrom.set(nb, cur);
        open.push(nb, tentative + geom.distance(nb, goal));
      }
    }
  }
  return null;
}

/**
 * Deterministic A* over navigable-water nodes for ships (P7).
 *
 * Returns the water-node sequence EXCLUDING `start` and INCLUDING `goal`, or
 * null when no all-water route exists. Both endpoints must be water nodes.
 * Tie-breaking is by ascending node id (via the shared min-heap), so ship routes
 * are identical across runs and platforms, and wrap across the torus like the
 * land walk A*.
 */
export function findWaterPath(
  world: World,
  geom: Geometry,
  start: number,
  goal: number,
): number[] | null {
  if (!isWaterNode(world, start) || !isWaterNode(world, goal)) return null;
  if (start === goal) return [];

  const open = new MinHeap();
  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  gScore.set(start, 0);
  open.push(start, geom.distance(start, goal));

  const closed = new Set<number>();
  while (open.size > 0) {
    const cur = open.pop();
    if (cur === goal) return rebuild(cameFrom, goal).slice(1);
    if (closed.has(cur)) continue;
    closed.add(cur);
    const curG = gScore.get(cur) as number;
    for (const nb of geom.neighbours(cur)) {
      if (closed.has(nb) || !isWaterNode(world, nb)) continue;
      const tentative = curG + 1;
      const known = gScore.get(nb);
      if (known === undefined || tentative < known) {
        gScore.set(nb, tentative);
        cameFrom.set(nb, cur);
        open.push(nb, tentative + geom.distance(nb, goal));
      }
    }
  }
  return null;
}

/** Adjacency for the flag/road graph of one player. */
interface FlagGraph {
  /** flagId -> array of { flag, road, cost }. */
  adj: Map<number, Array<{ flag: number; road: number; cost: number }>>;
}

/** Build the road-network adjacency for a player. */
export function buildFlagGraph(world: World, player: number): FlagGraph {
  const adj = new Map<number, Array<{ flag: number; road: number; cost: number }>>();
  const ensure = (f: number): Array<{ flag: number; road: number; cost: number }> => {
    let list = adj.get(f);
    if (!list) {
      list = [];
      adj.set(f, list);
    }
    return list;
  };
  for (const road of storeLive(world.roads)) {
    if (road.player !== player) continue;
    const cost = Math.max(1, road.path.length - 1);
    ensure(road.flagA).push({ flag: road.flagB, road: road.id, cost });
    ensure(road.flagB).push({ flag: road.flagA, road: road.id, cost });
  }
  // Sort neighbours by flag id for deterministic expansion order.
  for (const list of adj.values()) list.sort((a, b) => a.flag - b.flag);
  return { adj };
}

/**
 * A* over the road network from `startFlag` to `goalFlag`.
 *
 * Returns the flag-id sequence (including both endpoints) or null. Heuristic is
 * the lattice distance between flag nodes (admissible: an edge of length L
 * spans at least L lattice steps).
 */
export function findFlagRoute(
  world: World,
  geom: Geometry,
  graph: FlagGraph,
  startFlag: number,
  goalFlag: number,
): number[] | null {
  if (startFlag === goalFlag) return [startFlag];
  const goalNode = getFlag(world, goalFlag).node;

  const open = new MinHeap();
  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  gScore.set(startFlag, 0);
  open.push(startFlag, geom.distance(getFlag(world, startFlag).node, goalNode));
  const closed = new Set<number>();

  while (open.size > 0) {
    const cur = open.pop();
    if (cur === goalFlag) return rebuild(cameFrom, goalFlag);
    if (closed.has(cur)) continue;
    closed.add(cur);
    const curG = gScore.get(cur) as number;
    const list = graph.adj.get(cur) ?? [];
    for (const edge of list) {
      if (closed.has(edge.flag)) continue;
      const tentative = curG + edge.cost;
      const known = gScore.get(edge.flag);
      if (known === undefined || tentative < known) {
        gScore.set(edge.flag, tentative);
        cameFrom.set(edge.flag, cur);
        const h = geom.distance(getFlag(world, edge.flag).node, goalNode);
        open.push(edge.flag, tentative + h);
      }
    }
  }
  return null;
}

/** Find the road id connecting two adjacent flags, or -1. */
export function roadBetween(world: World, flagA: number, flagB: number): number {
  for (const road of storeLive(world.roads)) {
    if (
      (road.flagA === flagA && road.flagB === flagB) ||
      (road.flagA === flagB && road.flagB === flagA)
    ) {
      return road.id;
    }
  }
  return -1;
}

/** Confirm a road id still connects the two flags (used defensively). */
export function roadConnects(world: World, roadId: number, flagA: number, flagB: number): boolean {
  const r = getRoad(world, roadId);
  return (r.flagA === flagA && r.flagB === flagB) || (r.flagA === flagB && r.flagB === flagA);
}
