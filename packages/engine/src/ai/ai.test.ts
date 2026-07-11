/**
 * P6 AI opponent tests.
 *
 * - Gate: an AI player (1) beats a passive player (0) on a small map headlessly,
 *   proven by intermediate milestones (>=6 buildings, planks produced, >=2
 *   occupied military buildings, and the passive player's territory reduced by
 *   the AI's expansion) — superiority without needing a full elimination.
 * - Determinism: same seed -> identical world hash with the AI enabled.
 * - Units: build-site scoring and attack-target choice.
 */

import { describe, expect, it } from 'vitest';
import {
  createAiState,
  createWorld,
  GREENLAND_RULES,
  hashWorld,
  runAi,
  tickWorld,
  territoryOf,
  worldGeometry,
  buildingDef,
  ownerAt,
  OBJ_TYPE,
  OWNER_NONE,
  type GameEvent,
  type MapJson,
} from '../index';
import { flagsConnectedToHq, pickAttackTarget, pickBuildSite, planRoads } from './index';
import { MAX_ROAD_ATTEMPTS } from './roads';
import { applyCommand } from '../commands';
import { encodeBase64, makeFlatMap } from '../harness';
import { connectToHq, garrisonBuilding, spawnBuilding } from '../harness-economy';
import { storeAlloc, storeLive } from '../world';

/**
 * Flat all-meadow 2-player map with tree + granite clusters near the AI's HQ so
 * the wood/stone economy can bootstrap. Player 0 (passive) sits to the north.
 */
function makeAiMap(
  width: number,
  height: number,
  hq0: [number, number],
  hq1: [number, number],
): MapJson {
  const size = width * height;
  const meadow = new Array<number>(size).fill(0x08);
  const zero = new Array<number>(size).fill(0);
  const objType = new Array<number>(size).fill(0);
  const objIdx = new Array<number>(size).fill(0);
  const idx = (x: number, y: number): number =>
    (((y % height) + height) % height) * width + (((x % width) + width) % width);

  // Trees south of the AI HQ (for woodcutter + forester radius).
  for (let dx = -4; dx <= 4; dx++) {
    for (let dy = 3; dy <= 6; dy++) {
      const n = idx(hq1[0] + dx, hq1[1] + dy);
      objType[n] = OBJ_TYPE.treeMin;
      objIdx[n] = 0x30;
    }
  }
  // Granite south-east of the AI HQ (for the quarry).
  for (let dx = 3; dx <= 6; dx++) {
    for (let dy = 2; dy <= 5; dy++) {
      const n = idx(hq1[0] + dx, hq1[1] + dy);
      objType[n] = OBJ_TYPE.graniteMin;
      objIdx[n] = 0x06;
    }
  }

  return {
    title: 'ai-flat',
    width,
    height,
    terrain: 0,
    players: 2,
    hq_x: [hq0[0], hq1[0], 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
    hq_y: [hq0[1], hq1[1], 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
    encoding: 'base64',
    layers: {
      texture1: encodeBase64(meadow),
      texture2: encodeBase64(meadow),
      height: encodeBase64(zero),
      object_type: encodeBase64(objType),
      object_index: encodeBase64(objIdx),
      resources: encodeBase64(zero),
      owner: encodeBase64(zero),
    },
  };
}

/** Count occupied military buildings owned by `player`. */
function occupiedMilitary(world: ReturnType<typeof createWorld>, player: number): number {
  let n = 0;
  for (const b of storeLive(world.buildings)) {
    if (b.player === player && buildingDef(b.type)?.kind === 'military' && b.occupied) n++;
  }
  return n;
}

/** Count working (completed) non-HQ buildings owned by `player`. */
function completedBuildings(world: ReturnType<typeof createWorld>, player: number): number {
  let n = 0;
  for (const b of storeLive(world.buildings)) {
    if (b.player !== player || b.state !== 'working') continue;
    if (buildingDef(b.type)?.kind === 'hq') continue;
    n++;
  }
  return n;
}

describe('P6 AI gate — beats a passive player on a small map', () => {
  it('bootstraps an economy, occupies military, and shrinks the passive player', () => {
    // Tall map so the torus wrap distance (>=32) far exceeds the direct HQ
    // distance (24): the AI expands through the neutral zone, not over the pole.
    const map = makeAiMap(40, 56, [20, 12], [20, 36]);
    const world = createWorld(map, { seed: 4242, players: 2 });
    const ai = createAiState(1, { seed: 99 });
    const passiveTerritoryStart = territoryOf(world, 0).length;
    expect(passiveTerritoryStart).toBeGreaterThan(0);

    const milestones = {
      completed6: false,
      planks: false,
      occupied2: false,
      passiveShrunk: false,
    };
    let planksProduced = 0;

    const BUDGET = 45000;
    let lastTick = 0;
    for (let i = 0; i < BUDGET; i++) {
      runAi(world, ai); // AI issues this frame's commands
      const events: GameEvent[] = tickWorld(world);
      for (const e of events) {
        if (e.type === 'WareProduced' && e.wareType === 'plank' && e.player === 1) planksProduced++;
      }
      lastTick = i;
      if (i % 250 === 0 || i === BUDGET - 1) {
        if (completedBuildings(world, 1) >= 6) milestones.completed6 = true;
        if (planksProduced > 0) milestones.planks = true;
        if (occupiedMilitary(world, 1) >= 2) milestones.occupied2 = true;
        if (territoryOf(world, 0).length < passiveTerritoryStart) milestones.passiveShrunk = true;
        if (
          milestones.completed6 &&
          milestones.planks &&
          milestones.occupied2 &&
          milestones.passiveShrunk
        ) {
          break;
        }
      }
    }

    // Diagnostics travel with the assertion if a milestone is missed.
    const summary = {
      lastTick,
      completed: completedBuildings(world, 1),
      planksProduced,
      occupiedMilitary: occupiedMilitary(world, 1),
      passiveTerritoryStart,
      passiveTerritoryNow: territoryOf(world, 0).length,
      aiTerritory: territoryOf(world, 1).length,
    };
    expect({ ...milestones, summary }).toMatchObject({
      completed6: true,
      planks: true,
      occupied2: true,
      passiveShrunk: true,
    });
    // The AI ends up strictly larger than the player it is pressing.
    expect(summary.aiTerritory).toBeGreaterThan(summary.passiveTerritoryNow);
  }, 60000);
});

describe('P6 AI determinism', () => {
  it('produces identical world hashes for the same seed with AI enabled', () => {
    // Tall map so the torus wrap distance (>=32) far exceeds the direct HQ
    // distance (24): the AI expands through the neutral zone, not over the pole.
    const map = makeAiMap(40, 56, [20, 12], [20, 36]);
    const runOnce = (): string[] => {
      const world = createWorld(map, { seed: 2024, players: 2 });
      const ai = createAiState(1, { seed: 7 });
      const hashes: string[] = [];
      for (let i = 1; i <= 5000; i++) {
        runAi(world, ai);
        tickWorld(world);
        if (i % 1000 === 0) hashes.push(hashWorld(world));
      }
      return hashes;
    };
    const a = runOnce();
    const b = runOnce();
    expect(a).toEqual(b);
    expect(new Set(a).size).toBeGreaterThan(1); // world actually evolved
  }, 30000);
});

describe('P6 AI site selection', () => {
  const rules = GREENLAND_RULES;

  it('picks a buildable woodcutter site next to trees', () => {
    // Tall map so the torus wrap distance (>=32) far exceeds the direct HQ
    // distance (24): the AI expands through the neutral zone, not over the pole.
    const map = makeAiMap(40, 56, [20, 12], [20, 36]);
    const world = createWorld(map, { seed: 1, players: 2 });
    const geom = worldGeometry(world);
    const hq = world.buildings.items[world.players[1].hqBuildingId]!.node;
    const node = pickBuildSite(
      world,
      geom,
      rules,
      1,
      'woodcutter',
      { kind: 'nearTrees' },
      hq,
      16,
      14,
    );
    expect(node).toBeGreaterThanOrEqual(0);
    // A tree lies within the woodcutter's reach of the chosen site.
    let treeNear = false;
    for (let n = 0; n < geom.size; n++) {
      if (world.objectType[n] === OBJ_TYPE.treeMin && geom.distance(node, n) <= 6) treeNear = true;
    }
    expect(treeNear).toBe(true);
  });

  it('returns -1 when no tree is in range for a nearTrees bias', () => {
    // Plain flat map (no trees) via the shared harness helper.
    const map = makeFlatMap(20, 20, 4, 4);
    const world = createWorld(map, { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const hq = world.buildings.items[world.players[0].hqBuildingId]!.node;
    const node = pickBuildSite(
      world,
      geom,
      rules,
      0,
      'woodcutter',
      { kind: 'nearTrees' },
      hq,
      8,
      10,
    );
    expect(node).toBe(-1);
  });

  it('prefers a site close to the HQ for a nearHq bias', () => {
    const map = makeFlatMap(24, 24, 6, 6);
    const world = createWorld(map, { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const hq = world.buildings.items[world.players[0].hqBuildingId]!.node;
    const node = pickBuildSite(world, geom, rules, 0, 'sawmill', { kind: 'nearHq' }, hq, 10, 10);
    expect(node).toBeGreaterThanOrEqual(0);
    // Chosen site is within a couple of steps of the HQ (nearest buildable ring).
    expect(geom.distance(hq, node)).toBeLessThanOrEqual(3);
  });
});

describe('P6 AI road maintenance', () => {
  const rules = GREENLAND_RULES;

  it('resets a stale maxed attempt counter once the building is connected (finding 06)', () => {
    const map = makeFlatMap(30, 30, 6, 6);
    const world = createWorld(map, { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    // A working building wired to the HQ by a road: it is not stranded.
    const b = spawnBuilding(world, geom, geom.index(10, 6), 'woodcutter', 0, true);
    connectToHq(world, geom, b.node, 0);
    tickWorld(world); // queued buildRoad executes at tick start
    expect(flagsConnectedToHq(world, 0).has(b.flagId)).toBe(true);

    // A counter left maxed out from before the flag connected must not survive to
    // demolish this now-connected building (nor the next one to reuse the flag id).
    const ai = createAiState(0);
    ai.roadAttempts[b.flagId] = MAX_ROAD_ATTEMPTS;
    const cmds = planRoads(world, geom, rules, ai);
    expect(cmds.some((c) => c.type === 'demolish')).toBe(false);
    expect(ai.roadAttempts[b.flagId]).toBeUndefined();
  });

  it('clears the counter when it demolishes a permanently stranded building (finding 06)', () => {
    const map = makeFlatMap(30, 30, 6, 6);
    const world = createWorld(map, { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    // A working building with no road home: stranded, at the attempt limit.
    const b = spawnBuilding(world, geom, geom.index(20, 20), 'woodcutter', 0, true);
    const ai = createAiState(0);
    ai.roadAttempts[b.flagId] = MAX_ROAD_ATTEMPTS;
    const cmds = planRoads(world, geom, rules, ai);
    expect(cmds.some((c) => c.type === 'demolish' && c.node === b.node)).toBe(true);
    // Cleared so a rebuild reusing this door-flag id starts with a fresh budget.
    expect(ai.roadAttempts[b.flagId]).toBeUndefined();
  });

  it('routes a planned road around an interior flag so buildRoad accepts it (finding 07)', () => {
    // HQ at (11,9) so its door flag lands at (12,10): the road target T.
    const map = makeFlatMap(30, 30, 11, 9);
    const world = createWorld(map, { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const T = geom.index(12, 10);
    expect(world.flags.items[flagsConnectedToHq(world, 0).values().next().value!]!.node).toBe(T);

    // Stranded building whose door flag S=(10,10) sits two steps west of T on the
    // same even row: the unique 2-step route S->T runs through F=(11,10).
    const b = spawnBuilding(world, geom, geom.index(9, 9), 'woodcutter', 0, true);
    expect(world.flags.items[b.flagId]!.node).toBe(geom.index(10, 10));
    // A junction flag squarely on that straight route (buildRoad rejects any road
    // whose interior crosses a flag).
    const F = geom.index(11, 10);
    const fid = storeAlloc(world.flags, (id) => ({ id, node: F, player: 0, wares: [] }));
    world.flagAtNode[F] = fid;

    const ai = createAiState(0);
    const cmds = planRoads(world, geom, rules, ai);
    const road = cmds.find((c) => c.type === 'buildRoad');
    expect(road).toBeDefined();
    if (!road || road.type !== 'buildRoad') throw new Error('expected a buildRoad command');
    // The planned road must not cross the interior flag F...
    expect(road.path.slice(1, -1)).not.toContain(F);
    // ...and applying it actually connects the building (execBuildRoad accepts it).
    applyCommand(world, road);
    tickWorld(world); // queued buildRoad executes at tick start
    expect(flagsConnectedToHq(world, 0).has(b.flagId)).toBe(true);
  });

  it('detours a planned road around neutral land, never through it (task 1)', () => {
    // HQ at (11,9) so its door flag lands at (12,10): the road target T.
    const map = makeFlatMap(30, 30, 11, 9);
    const world = createWorld(map, { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const T = geom.index(12, 10);
    expect(world.flags.items[flagsConnectedToHq(world, 0).values().next().value!]!.node).toBe(T);

    // Stranded building whose door flag S=(10,10) sits two steps west of T on the
    // same even row: the unique 2-step shortcut S->T runs through M=(11,10).
    const b = spawnBuilding(world, geom, geom.index(9, 9), 'woodcutter', 0, true);
    expect(world.flags.items[b.flagId]!.node).toBe(geom.index(10, 10));

    // Carve M out of our territory: it becomes neutral, so execBuildRoad rejects
    // any road crossing it. An all-owned detour via (11,11) still exists, so the
    // AI must plan that instead of the shorter straight line through neutral land.
    const M = geom.index(11, 10);
    world.owner[M] = OWNER_NONE;
    expect(ownerAt(world, M)).toBe(-1);
    expect(ownerAt(world, geom.index(11, 11))).toBe(0); // detour node still ours

    const ai = createAiState(0);
    const cmds = planRoads(world, geom, rules, ai);
    const road = cmds.find((c) => c.type === 'buildRoad');
    expect(road).toBeDefined();
    if (!road || road.type !== 'buildRoad') throw new Error('expected a buildRoad command');
    // The planned road never touches the neutral node M (fails if planRoads still
    // plans the geometric shortcut, which execBuildRoad would then reject)...
    expect(road.path).not.toContain(M);
    // ...and applying it actually connects the building over owned land.
    applyCommand(world, road);
    tickWorld(world); // queued buildRoad executes at tick start
    expect(flagsConnectedToHq(world, 0).has(b.flagId)).toBe(true);
  });
});

describe('P6 AI attack-target choice', () => {
  const rules = GREENLAND_RULES;

  it('targets the weakest reachable enemy military building', () => {
    const map = makeFlatMap(30, 30, 6, 6);
    const world = createWorld(
      {
        ...map,
        players: 2,
        hq_x: [6, 20, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
        hq_y: [6, 6, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
      },
      { seed: 1, players: 2 },
    );
    const geom = worldGeometry(world);

    // AI (player 1) fortress with a real surplus near two enemy buildings.
    const mine = spawnBuilding(world, geom, geom.index(16, 6), 'fortress', 1, true);
    garrisonBuilding(mine, [5, 0, 0, 0, 0]); // 5 privates, surplus of 4

    // Two enemy (player 0) buildings: a strong watchtower and a weak barracks,
    // both reachable — the weaker barracks should be chosen.
    const strong = spawnBuilding(world, geom, geom.index(12, 6), 'watchtower', 0, true);
    garrisonBuilding(strong, [0, 0, 3, 0, 0]); // 3 sergeants (strong)
    const weak = spawnBuilding(world, geom, geom.index(13, 8), 'barracks', 0, true);
    garrisonBuilding(weak, [1, 0, 0, 0, 0]); // 1 private (weak)

    const pick = pickAttackTarget(world, geom, rules, 1);
    expect(pick).not.toBeNull();
    expect(pick!.targetBuildingId).toBe(weak.id);
    expect(pick!.soldiers).toBeGreaterThanOrEqual(1);
  });

  it('falls back to the enemy HQ when no military targets remain', () => {
    const map = makeFlatMap(30, 30, 6, 6);
    const world = createWorld(
      {
        ...map,
        players: 2,
        hq_x: [6, 20, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
        hq_y: [6, 6, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
      },
      { seed: 1, players: 2 },
    );
    const geom = worldGeometry(world);

    // AI (player 1) fortress with a surplus; the enemy has no military
    // buildings left, only its headquarters at (6,6).
    const fort = spawnBuilding(world, geom, geom.index(12, 6), 'fortress', 1, true);
    garrisonBuilding(fort, [5, 0, 0, 0, 0]);

    const pick = pickAttackTarget(world, geom, GREENLAND_RULES, 1);
    expect(pick).not.toBeNull();
    expect(pick!.targetBuildingId).toBe(world.players[0].hqBuildingId);
  });

  it('prefers a military target over the enemy HQ', () => {
    const map = makeFlatMap(30, 30, 6, 6);
    const world = createWorld(
      {
        ...map,
        players: 2,
        hq_x: [6, 20, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
        hq_y: [6, 6, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
      },
      { seed: 1, players: 2 },
    );
    const geom = worldGeometry(world);

    const fort = spawnBuilding(world, geom, geom.index(12, 6), 'fortress', 1, true);
    garrisonBuilding(fort, [5, 0, 0, 0, 0]);
    // A garrisoned enemy barracks: strictly stronger than the strength-0 HQ,
    // but still the preferred target.
    const barracks = spawnBuilding(world, geom, geom.index(9, 6), 'barracks', 0, true);
    garrisonBuilding(barracks, [2, 0, 0, 0, 0]);

    const pick = pickAttackTarget(world, geom, GREENLAND_RULES, 1);
    expect(pick).not.toBeNull();
    expect(pick!.targetBuildingId).toBe(barracks.id);
  });

  it('returns null when the AI has no soldier surplus', () => {
    const map = makeFlatMap(30, 30, 6, 6);
    const world = createWorld(
      {
        ...map,
        players: 2,
        hq_x: [6, 20, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
        hq_y: [6, 6, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
      },
      { seed: 1, players: 2 },
    );
    const geom = worldGeometry(world);
    const mine = spawnBuilding(world, geom, geom.index(16, 6), 'guardhouse', 1, true);
    garrisonBuilding(mine, [1, 0, 0, 0, 0]); // only the lone keeper — no surplus
    const enemy = spawnBuilding(world, geom, geom.index(12, 6), 'barracks', 0, true);
    garrisonBuilding(enemy, [1, 0, 0, 0, 0]);
    expect(pickAttackTarget(world, geom, rules, 1)).toBeNull();
  });

  it('end to end: the AI attacks and captures a reachable enemy military building', () => {
    const map = makeFlatMap(30, 30, 6, 6);
    const world = createWorld(
      {
        ...map,
        players: 2,
        hq_x: [6, 20, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
        hq_y: [6, 6, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
      },
      { seed: 55, players: 2 },
    );
    const geom = worldGeometry(world);
    // No idle reinforcement pools (same setup as the military tests): otherwise
    // the passive player's engine-side occupation endlessly refills the target.
    world.players[0].soldiers = [0, 0, 0, 0, 0];
    world.players[1].soldiers = [0, 0, 0, 0, 0];

    // AI (player 1) guardhouse with a surplus; enemy (player 0) barracks in reach.
    const mine = spawnBuilding(world, geom, geom.index(16, 8), 'guardhouse', 1, true);
    garrisonBuilding(mine, [3, 0, 0, 0, 0]);
    const target = spawnBuilding(world, geom, geom.index(12, 8), 'barracks', 0, true);
    garrisonBuilding(target, [1, 0, 0, 0, 0]);

    const ai = createAiState(1, { seed: 5 });
    let captured = false;
    for (let i = 0; i < 3000 && !captured; i++) {
      runAi(world, ai);
      for (const e of tickWorld(world)) {
        if (e.type === 'BuildingCaptured' && e.toPlayer === 1 && e.buildingId === target.id) {
          captured = true;
        }
      }
    }
    expect(captured).toBe(true);
    expect(world.buildings.items[target.id]?.player).toBe(1);
  }, 20000);
});
