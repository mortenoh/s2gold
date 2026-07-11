/**
 * Geologist survey: sending one from a flag walks it out, reveals the ore under
 * nearby mountains as signs, and returns the Helper to the pool.
 */

import { describe, expect, it } from 'vitest';
import { applyCommand, createWorld, tickWorld, worldGeometry } from './index';
import { storeLive } from './world';
import { JOB, RESOURCE } from './constants';
import { makeFlatMap } from './harness';
import { paintMountain, setResource } from './harness-economy';

describe('geologist survey', () => {
  it('places a sign showing the ore under a nearby mountain and returns the helper', () => {
    const world = createWorld(makeFlatMap(30, 30, 2, 2), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    // A coal mountain patch around (6,6) (inside the HQ's territory), flag next to it.
    const m = geom.index(6, 6);
    for (const d of geom.neighbours(m)) paintMountain(world, d);
    paintMountain(world, m);
    setResource(world, m, RESOURCE.coal, 7);
    const flagNode = geom.index(5, 6);
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

  it('retires instead of crashing tickWorld when its home is razed mid-survey', () => {
    const world = createWorld(makeFlatMap(30, 30, 2, 2), { seed: 2, players: 1 });
    const geom = worldGeometry(world);
    const flagNode = geom.index(6, 6);
    applyCommand(world, { type: 'placeFlag', player: 0, node: flagNode });
    tickWorld(world);
    applyCommand(world, { type: 'sendGeologist', player: 0, flagNode });

    let out = false;
    for (let i = 0; i < 200 && !out; i++) {
      tickWorld(world);
      out = [...storeLive(world.settlers)].some((s) => s.job === JOB.geologist);
    }
    expect(out).toBe(true); // the geologist is under way

    // Raze the home HQ the way captureBuilding does: free the slot in place.
    const hqId = world.players[0].hqBuildingId;
    const hq = world.buildings.items[hqId];
    expect(hq).toBeTruthy();
    world.buildingAtNode[hq!.node] = -1;
    world.buildings.items[hqId] = null;
    world.buildings.free.push(hqId);
    world.players[0].hqBuildingId = -1;

    // Pre-fix this threw 'no building N' out of tickWorld once the survey
    // timer expired, permanently killing the simulation.
    expect(() => {
      for (let i = 0; i < 3000; i++) tickWorld(world);
    }).not.toThrow();

    // The stranded geologist retired rather than lingering forever.
    expect([...storeLive(world.settlers)].some((s) => s.job === JOB.geologist)).toBe(false);
  });
});
