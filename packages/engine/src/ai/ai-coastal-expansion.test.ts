/**
 * AI coast-directed expansion gate: an island-bound AI with NO reachable enemy
 * grows its territory out to a shore and then colonises a second island.
 *
 * This exercises the gap the two-island seafaring fixture cannot: there the HQ's
 * starting territory disc already pokes onto the far island, so a harbor is
 * foundable at once and no expansion happens. Here the HQ sits fully inland (its
 * disc touches no coast), so the seafaring cascade must first RUN THE COAST DRIVE
 * — a chain of occupied, road-connected guardhouses that steps the frontier to a
 * harbor-capable shore — before it can found a harbor, build a ship, and settle
 * the unowned island across the water. All via the normal command layer (runAi).
 *
 * Mirrors ai-seafaring.test.ts (milestone-gated autonomous run + replay
 * determinism) on {@link makeExpansionIslandMap}.
 */

import { describe, expect, it } from 'vitest';
import {
  buildingDef,
  createAiState,
  createWorld,
  hashWorld,
  harborsOf,
  ownerAt,
  runAi,
  shipsOf,
  tickWorld,
  type GameEvent,
  type World,
} from '../index';
import { makeExpansionIslandMap, EXPANSION_ISLAND } from '../harness';
import { storeLive } from '../world';

/** Working + under-construction military buildings owned by `player`. */
function militaryCount(world: World, player: number): number {
  let n = 0;
  for (const b of storeLive(world.buildings)) {
    if (b.player === player && buildingDef(b.type)?.kind === 'military') n++;
  }
  return n;
}

/** A harbor owned by `player` sitting on the target island (cols <= max). */
function harborOnTargetIsland(world: World, player: number): boolean {
  const W = world.width;
  return harborsOf(world, player).some((h) => h.node % W <= EXPANSION_ISLAND.targetCols.max);
}

describe('AI coastal expansion gate — expands to the sea, then colonises an island', () => {
  it('grows territory to a shore, founds a harbor, and settles the far island', () => {
    const world = createWorld(makeExpansionIslandMap(), { seed: 1, players: 1 });
    const initialTerritory = 271; // the inland HQ disc, verified by the harness

    const ai = createAiState(0, { seed: 7 });
    const milestones = {
      expanded: false, // built military AND grew territory beyond the HQ disc (coast drive)
      harborHome: false, // a working harbor on the home island (cols >= 12)
      ship: false, // a ship exists
      landed: false, // ExpeditionLanded fired
      islandTarget: false, // a founded harbor on the target island (colonised)
    };
    let landedNode = -1;

    const BUDGET = 45000;
    let lastTick = 0;
    for (let i = 0; i < BUDGET; i++) {
      runAi(world, ai);
      const events: GameEvent[] = tickWorld(world);
      for (const e of events)
        if (e.type === 'ExpeditionLanded' && e.player === 0) landedNode = e.node;
      lastTick = i;
      if (i % 200 === 0 || i === BUDGET - 1) {
        let territory = 0;
        for (let n = 0; n < world.owner.length; n++) if (ownerAt(world, n) === 0) territory++;
        if (militaryCount(world, 0) >= 1 && territory > initialTerritory)
          milestones.expanded = true;
        for (const b of storeLive(world.buildings)) {
          if (b.player === 0 && b.type === 'harbor' && b.state === 'working') {
            // Home island lies east of the water channel; the target island is
            // cols <= targetCols.max. Anything past it is a home-island harbor.
            if (b.node % world.width > EXPANSION_ISLAND.targetCols.max)
              milestones.harborHome = true;
          }
        }
        if (shipsOf(world, 0).length > 0) milestones.ship = true;
        if (landedNode >= 0) milestones.landed = true;
        if (harborOnTargetIsland(world, 0) && landedNode >= 0) milestones.islandTarget = true;
        if (milestones.islandTarget) break;
      }
    }

    const W = world.width;
    const summary = {
      lastTick,
      landedNode: landedNode >= 0 ? [landedNode % W, Math.floor(landedNode / W)] : null,
      harbors: harborsOf(world, 0).map((h) => [h.node % W, Math.floor(h.node / W)]),
      military: militaryCount(world, 0),
    };
    expect({ ...milestones, summary }).toMatchObject({
      expanded: true,
      harborHome: true,
      ship: true,
      landed: true,
      islandTarget: true,
    });
    // The colony sits on the target island (cols <= max), a genuine sea crossing.
    expect(landedNode % W).toBeLessThanOrEqual(EXPANSION_ISLAND.targetCols.max);
  }, 120000);
});

describe('AI coastal expansion determinism', () => {
  it('replays identically: same seed -> identical world hashes with the coast drive active', () => {
    const runOnce = (): string[] => {
      const world = createWorld(makeExpansionIslandMap(), { seed: 1, players: 1 });
      const ai = createAiState(0, { seed: 7 });
      const hashes: string[] = [];
      for (let i = 1; i <= 18000; i++) {
        runAi(world, ai);
        tickWorld(world);
        if (i % 6000 === 0) hashes.push(hashWorld(world));
      }
      return hashes;
    };
    const a = runOnce();
    const b = runOnce();
    expect(a).toEqual(b);
    expect(new Set(a).size).toBeGreaterThan(1); // the world actually evolved
  }, 120000);
});
