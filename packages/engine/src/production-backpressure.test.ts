/**
 * Outdoor producers (harvesters + the farm) must honour the same outputQueue
 * backpressure guard the in-building producers have: when the door flag is
 * saturated and cannot drain, the worker stays idle in the building instead of
 * marching out to strip finite map resources into an ever-growing queue.
 */

import { describe, expect, it } from 'vitest';
import { createWorld, tickWorld, worldGeometry } from './index';
import { isTreeType, OBJ_TYPE } from './constants';
import { makeFlatMap } from './harness';
import { spawnBuilding } from './harness-economy';

describe('outdoor harvester outputQueue backpressure', () => {
  it('a woodcutter with a full, undrainable flag stops felling trees and its queue stays bounded', () => {
    const world = createWorld(makeFlatMap(24, 24, 2, 2), { seed: 1, players: 1 });
    const geom = worldGeometry(world);

    const wcNode = geom.index(14, 14);
    const flagNode = geom.neighbour(wcNode, 'SE');

    // Blanket the work radius with trees, well beyond what a bounded producer
    // could fell, so any exhaustion is backpressure and not running out of trees.
    let planted = 0;
    for (let node = 0; node < geom.size; node++) {
      if (node === wcNode || node === flagNode) continue;
      if (geom.distance(wcNode, node) > 6) continue;
      world.objectType[node] = OBJ_TYPE.treeMin;
      world.objectIndex[node] = 0;
      planted++;
    }
    expect(planted).toBeGreaterThan(40);

    // Unstaffed so it recruits + free-walks its worker in; NO road connects its
    // flag, so the 8 flag slots fill once and can never drain.
    const wc = spawnBuilding(world, geom, wcNode, 'woodcutter', 0, false);

    for (let i = 0; i < 6000; i++) tickWorld(world);

    let treesLeft = 0;
    for (let node = 0; node < geom.size; node++) {
      if (isTreeType(world.objectType[node])) treesLeft++;
    }
    const felled = planted - treesLeft;

    // Buffered output caps at 8 on the flag + 8 in the queue: the worker never
    // goes out once the queue is full, so it fells at most 16 trees total.
    expect(wc.outputQueue.length).toBeLessThanOrEqual(8);
    expect(felled).toBeLessThanOrEqual(16);
    expect(treesLeft).toBeGreaterThan(0);
  });
});
