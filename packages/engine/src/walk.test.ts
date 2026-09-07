import { describe, expect, it } from 'vitest';

import { GREENLAND_RULES } from './terrain';
import { isWalkableNode } from './walk';
import { createWorld, worldGeometry } from './index';
import { makeFlatMap } from './harness';

/** Paint both texture layers of `node` (the two triangles it owns). */
function paint(world: ReturnType<typeof createWorld>, node: number, id: number): void {
  world.terrain1[node] = id;
  world.terrain2[node] = id;
}

describe('node walkability (six-triangle rule)', () => {
  it('walks the shore: a node whose own triangles are water but with meadow around', () => {
    const world = createWorld(makeFlatMap(16, 16, 2, 2), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const node = geom.index(8, 8);
    paint(world, node, 0x05); // the node's own two triangles are water
    expect(isWalkableNode(world, geom, node, GREENLAND_RULES)).toBe(true);
  });

  it('cannot stand in the middle of water, swamp or snow', () => {
    const world = createWorld(makeFlatMap(16, 16, 2, 2), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const node = geom.index(8, 8);
    for (const id of [0x05, 0x03, 0x02]) {
      for (const t of geom.trianglesAround(node)) {
        if (t.layer === 1) world.terrain1[t.node] = id;
        else world.terrain2[t.node] = id;
      }
      expect(isWalkableNode(world, geom, node, GREENLAND_RULES)).toBe(false);
    }
  });

  it('never touches lava, even with meadow on the other side', () => {
    const world = createWorld(makeFlatMap(16, 16, 2, 2), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const node = geom.index(8, 8);
    world.terrain1[node] = 0x10; // one lava triangle out of six
    expect(isWalkableNode(world, geom, node, GREENLAND_RULES)).toBe(false);
  });
});
