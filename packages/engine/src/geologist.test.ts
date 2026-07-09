/**
 * Geologist survey: sending one from a flag walks it out, reveals the ore under
 * nearby mountains as signs, and returns the Helper to the pool.
 */

import { describe, expect, it } from 'vitest';
import { applyCommand, createWorld, tickWorld, worldGeometry } from './index';
import { JOB, RESOURCE } from './constants';
import { makeFlatMap } from './harness';
import { paintMountain, setResource } from './harness-economy';

describe('geologist survey', () => {
  it('places a sign showing the ore under a nearby mountain and returns the helper', () => {
    const world = createWorld(makeFlatMap(30, 30, 2, 2), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    // A coal mountain patch around (10,10), with a flag next to it.
    const m = geom.index(10, 10);
    for (const d of geom.neighbours(m)) paintMountain(world, d);
    paintMountain(world, m);
    setResource(world, m, RESOURCE.coal, 7);
    const flagNode = geom.index(9, 10);
    applyCommand(world, { type: 'placeFlag', player: 0, node: flagNode });
    tickWorld(world);

    const helpersBefore = world.players[0].workers[JOB.carrier];
    applyCommand(world, { type: 'sendGeologist', player: 0, flagNode });

    let coalSign = false;
    for (let i = 0; i < 2000 && !coalSign; i++) {
      tickWorld(world);
      coalSign = world.signs.some((s) => s.res === RESOURCE.coal);
    }
    expect(coalSign).toBe(true); // the coal deposit was revealed

    // Run out the return trip; the Helper is back in the pool (net zero cost).
    for (let i = 0; i < 2000; i++) tickWorld(world);
    expect(world.players[0].workers[JOB.carrier]).toBe(helpersBefore);
  });
});
