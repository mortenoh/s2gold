/**
 * AI seafaring gate: an AI seeded on island A colonises island B autonomously.
 *
 * The AI is given only the normal command layer (runAi) and a small island-A
 * economy (a tree cluster + a granite pile so the wood/stone chain sustains, on
 * top of the HQ's starting board/stone stock). With no land left to expand onto
 * — island A is tiny and there is no enemy to push toward — the land planner
 * exhausts, the seafaring cascade takes over, and the AI must:
 *   found a harbor -> build a shipyard -> get a ship -> assemble a kit ->
 *   launch an expedition -> found a harbor on island B (new territory).
 *
 * Mirrors seafaring.test.ts (the command-driven flow) and ai.test.ts (the
 * milestone-gated autonomous run), plus a replay-determinism check.
 */

import { describe, expect, it } from 'vitest';
import {
  createAiState,
  createWorld,
  hashWorld,
  harborsOf,
  ownerAt,
  runAi,
  shipsOf,
  tickWorld,
  worldGeometry,
  OBJ_TYPE,
  type GameEvent,
  type World,
} from '../index';
import { makeTwoIslandMap } from '../harness';
import { storeLive } from '../world';

/**
 * The two-island fixture plus a self-sustaining island-A economy: a tree block
 * (woodcutter + forester + sawmill -> planks) and a granite pile (quarry ->
 * stones). Objects are written straight onto the world (the harness-economy
 * pattern), inside island A (cols 4..8, rows 4..9) but clear of the HQ at (6,6).
 */
function makeSeaAiWorld(seed: number): World {
  const world = createWorld(makeTwoIslandMap(), { seed, players: 1 });
  const geom = worldGeometry(world);
  const tree = (x: number, y: number): void => {
    world.objectType[geom.index(x, y)] = OBJ_TYPE.treeMin;
    world.objectIndex[geom.index(x, y)] = 0x30;
  };
  // Tree cluster along the south edge of island A (rows 8..9).
  for (let x = 4; x <= 8; x++) {
    tree(x, 9);
    if (x !== 6) tree(x, 8);
  }
  // Granite on the north-east of island A.
  world.objectType[geom.index(8, 4)] = OBJ_TYPE.graniteMin;
  world.objectIndex[geom.index(8, 4)] = 0x06;
  world.objectType[geom.index(8, 5)] = OBJ_TYPE.graniteMin;
  world.objectIndex[geom.index(8, 5)] = 0x06;
  return world;
}

/** A harbor owned by `player` sitting on island B (cols 15..19). */
function harborOnIslandB(world: World, player: number): boolean {
  const W = world.width;
  return harborsOf(world, player).some((h) => {
    const x = h.node % W;
    return x >= 15 && x <= 19;
  });
}

describe('AI seafaring gate — colonises a second island autonomously', () => {
  it('founds a harbor, builds a ship, and settles island B', () => {
    const world = makeSeaAiWorld(31);
    const ai = createAiState(0, { seed: 5 });

    const milestones = {
      harborA: false, // a working harbor on island A
      ship: false, // a ship exists
      landed: false, // ExpeditionLanded fired
      islandB: false, // a founded harbor + owned territory on island B
    };
    let landedNode = -1;

    const BUDGET = 60000;
    let lastTick = 0;
    for (let i = 0; i < BUDGET; i++) {
      runAi(world, ai);
      const events: GameEvent[] = tickWorld(world);
      for (const e of events)
        if (e.type === 'ExpeditionLanded' && e.player === 0) landedNode = e.node;
      lastTick = i;
      if (i % 200 === 0 || i === BUDGET - 1) {
        for (const b of storeLive(world.buildings)) {
          if (b.player === 0 && b.type === 'harbor' && b.state === 'working') {
            const x = b.node % world.width;
            if (x >= 4 && x <= 8) milestones.harborA = true;
          }
        }
        if (shipsOf(world, 0).length > 0) milestones.ship = true;
        if (landedNode >= 0) milestones.landed = true;
        // Colonisation proved by a founded harbor on island B whose landing node
        // the AI now owns (territory established across the water).
        if (harborOnIslandB(world, 0) && landedNode >= 0 && ownerAt(world, landedNode) === 0) {
          milestones.islandB = true;
        }
        if (milestones.islandB) break;
      }
    }

    const W = world.width;
    const summary = {
      lastTick,
      landedNode: landedNode >= 0 ? [landedNode % W, Math.floor(landedNode / W)] : null,
      harbors: harborsOf(world, 0).map((h) => [h.node % W, Math.floor(h.node / W)]),
      ships: shipsOf(world, 0).length,
    };
    expect({ ...milestones, summary }).toMatchObject({
      harborA: true,
      ship: true,
      landed: true,
      islandB: true,
    });
    // The colony sits on island B (cols 15..19), a genuine sea crossing.
    expect(landedNode % W).toBeGreaterThanOrEqual(15);
  }, 120000);
});

describe('AI seafaring determinism', () => {
  it('replays identically: same seed -> identical world hashes with seafaring active', () => {
    const runOnce = (): string[] => {
      const world = makeSeaAiWorld(31);
      const ai = createAiState(0, { seed: 5 });
      const hashes: string[] = [];
      for (let i = 1; i <= 12000; i++) {
        runAi(world, ai);
        tickWorld(world);
        if (i % 3000 === 0) hashes.push(hashWorld(world));
      }
      return hashes;
    };
    const a = runOnce();
    const b = runOnce();
    expect(a).toEqual(b);
    expect(new Set(a).size).toBeGreaterThan(1); // the world actually evolved
  }, 120000);
});
