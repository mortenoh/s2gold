/**
 * HQ population growth (code review): the Helper pool must top back up over time
 * so an expanding settlement never permanently runs dry. Without it, once the
 * fixed starting pool is spent on road carriers + worker recruitment, new roads
 * get no carrier and the buildings they serve deadlock unbuilt.
 */

import { describe, expect, it } from 'vitest';
import { createWorld, tickWorld } from './index';
import { JOB } from './constants';
import { makeFlatMap } from './harness';

describe('helper pool replenishes over time', () => {
  it('regrows a drained pool back toward the buffer while the HQ works', () => {
    const world = createWorld(makeFlatMap(30, 30, 2, 2), { seed: 1, players: 1 });
    // Drain the Helper pool as heavy expansion would.
    world.players[0].workers[JOB.carrier] = 0;

    for (let i = 0; i < 400; i++) tickWorld(world);

    // The HQ has been producing settlers: the pool is no longer empty.
    expect(world.players[0].workers[JOB.carrier]).toBeGreaterThan(0);
  });

  it('does not inflate past the buffer', () => {
    const world = createWorld(makeFlatMap(30, 30, 2, 2), { seed: 1, players: 1 });
    for (let i = 0; i < 4000; i++) tickWorld(world);
    // Bounded: growth stops at a small idle buffer, not unbounded accumulation.
    expect(world.players[0].workers[JOB.carrier]).toBeLessThanOrEqual(60);
  });
});
