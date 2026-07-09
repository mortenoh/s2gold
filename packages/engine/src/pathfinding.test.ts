import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  buildFlagGraph,
  createWorld,
  findFlagRoute,
  findWalkPath,
  flagAt,
  GREENLAND_RULES,
  tickWorld,
  worldGeometry,
} from './index';
import { makeFlatMap } from './harness';

describe('findWalkPath', () => {
  it('takes the wrap-around shortest path on a torus', () => {
    const world = createWorld(makeFlatMap(8, 8), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const start = geom.index(0, 4);
    const goal = geom.index(7, 4);
    const path = findWalkPath(world, geom, GREENLAND_RULES, start, goal);
    expect(path).not.toBeNull();
    expect(path).toHaveLength(1); // one step west across the seam
    expect(path?.[0]).toBe(goal);
  });

  it('routes around a building that blocks the direct step', () => {
    const world = createWorld(makeFlatMap(10, 10, 0, 0), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const start = geom.index(5, 5);
    const goal = geom.index(7, 5);
    const path = findWalkPath(world, geom, GREENLAND_RULES, start, goal);
    expect(path?.[path.length - 1]).toBe(goal);
  });
});

describe('findFlagRoute', () => {
  it('finds a multi-hop route over the road network', () => {
    const world = createWorld(makeFlatMap(16, 16, 1, 1), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const y = 8;
    const nodes = [3, 5, 7].map((x) => geom.index(x, y));
    for (const n of nodes) applyCommand(world, { tick: 0, player: 0, type: 'placeFlag', node: n });
    tickWorld(world);
    for (const n of nodes) expect(flagAt(world, n)).not.toBeNull();

    const road1 = [nodes[0], geom.index(4, y), nodes[1]];
    const road2 = [nodes[1], geom.index(6, y), nodes[2]];
    applyCommand(world, { tick: world.tick, player: 0, type: 'buildRoad', path: road1 });
    applyCommand(world, { tick: world.tick, player: 0, type: 'buildRoad', path: road2 });
    tickWorld(world);

    const fa = flagAt(world, nodes[0])!.id;
    const fb = flagAt(world, nodes[1])!.id;
    const fc = flagAt(world, nodes[2])!.id;
    const graph = buildFlagGraph(world, 0);
    const route = findFlagRoute(world, geom, graph, fa, fc);
    expect(route).toEqual([fa, fb, fc]);
  });

  it('returns null when flags are not connected', () => {
    const world = createWorld(makeFlatMap(16, 16, 1, 1), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const a = geom.index(3, 8);
    const b = geom.index(9, 8);
    applyCommand(world, { tick: 0, player: 0, type: 'placeFlag', node: a });
    applyCommand(world, { tick: 0, player: 0, type: 'placeFlag', node: b });
    tickWorld(world);
    const graph = buildFlagGraph(world, 0);
    const route = findFlagRoute(world, geom, graph, flagAt(world, a)!.id, flagAt(world, b)!.id);
    expect(route).toBeNull();
  });
});
