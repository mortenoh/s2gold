/**
 * Regression tests for ownership / territory validation gaps (code review).
 */

import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  canPlaceBuilding,
  createWorld,
  GREENLAND_RULES,
  ownerAt,
  tickWorld,
  worldGeometry,
  type GameEvent,
} from './index';
import { JOB } from './constants';
import { makeFlatMap } from './harness';
import {
  claimArea,
  connectRoad,
  connectToHq,
  garrisonBuilding,
  placeBuildingAndTick,
  spawnBuilding,
} from './harness-economy';
import { recalcTerritory } from './systems/territory';
import { storeAlloc, storeLive } from './world';

type TestWorld = ReturnType<typeof createWorld>;

/** Every soldier a player owns: idle pool + all garrisons + live soldier settlers. */
function soldierTotal(world: TestWorld, player: number): number {
  let n = world.players[player].soldiers.reduce((a, c) => a + c, 0);
  for (const b of storeLive(world.buildings)) {
    if (b.player === player) n += b.garrison.reduce((a, c) => a + c, 0);
  }
  for (const s of storeLive(world.settlers)) {
    if (s.player === player && s.rank >= 0) n++;
  }
  return n;
}

function run(world: ReturnType<typeof createWorld>, n: number): GameEvent[] {
  const all: GameEvent[] = [];
  for (let i = 0; i < n; i++) all.push(...tickWorld(world));
  return all;
}

describe('demolishing a territory building releases its land', () => {
  it('reverts owned nodes to neutral and emits TerritoryChanged', () => {
    const world = createWorld(makeFlatMap(40, 40, 1, 1), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const ghNode = geom.index(24, 24); // far from the HQ (radius 9) -> its claim is solely the guardhouse's
    const gh = spawnBuilding(world, geom, ghNode, 'guardhouse', 0);
    garrisonBuilding(gh, [3, 0, 0, 0, 0]); // occupied -> projects territory
    recalcTerritory(world, geom);
    expect(ownerAt(world, ghNode)).toBe(0); // claimed

    const events = [
      ...(applyCommand(world, { type: 'demolish', player: 0, node: ghNode }), run(world, 1)),
    ];
    expect(ownerAt(world, ghNode)).toBe(-1); // land released (was stale before the fix)
    expect(events.some((e) => e.type === 'TerritoryChanged')).toBe(true);
  });
});

describe('flag ownership is enforced', () => {
  it('a building cannot reuse another player’s door flag', () => {
    // Player 1's HQ near (20,20) gives that corner to player 1 (radius 9).
    const world = createWorld(makeFlatMap(40, 40, 1, 1, [{ x: 16, y: 20 }]), {
      seed: 1,
      players: 2,
    });
    const geom = worldGeometry(world);
    const buildNode = geom.index(20, 20);
    const doorNode = geom.neighbour(buildNode, 'SE');
    applyCommand(world, { type: 'placeFlag', player: 1, node: doorNode }); // player 1 owns the door
    tickWorld(world);
    expect(canPlaceBuilding(world, geom, GREENLAND_RULES, buildNode, 'woodcutter', 0)).toBe(false);
    expect(canPlaceBuilding(world, geom, GREENLAND_RULES, buildNode, 'woodcutter', 1)).toBe(true);
  });

  it('a road cannot be built between another player’s flags', () => {
    // Player 1's HQ near (20,20) owns the whole a..b span these flags/road use.
    const world = createWorld(makeFlatMap(40, 40, 1, 1, [{ x: 16, y: 20 }]), {
      seed: 1,
      players: 2,
    });
    const geom = worldGeometry(world);
    const a = geom.index(20, 20);
    const n1 = geom.neighbour(a, 'E');
    const n2 = geom.neighbour(n1, 'E');
    const b = geom.neighbour(n2, 'E'); // 3 tiles from a, past FLAG_MIN_DISTANCE
    applyCommand(world, { type: 'placeFlag', player: 1, node: a });
    applyCommand(world, { type: 'placeFlag', player: 1, node: b });
    tickWorld(world);
    const path = [a, n1, n2, b];
    const before = [...storeLive(world.roads)].length;
    applyCommand(world, { type: 'buildRoad', player: 0, path }); // player 0 across player-1 flags
    tickWorld(world);
    expect([...storeLive(world.roads)].length).toBe(before); // rejected
    applyCommand(world, { type: 'buildRoad', player: 1, path }); // rightful owner
    tickWorld(world);
    expect([...storeLive(world.roads)].length).toBe(before + 1);
  });
});

describe('soldiers are never silently deleted', () => {
  it('attackers walk home when the target is demolished mid-march', () => {
    // P0 at (2,2), P1 at (34,10); a P0 guardhouse attacks a nearby P1 one.
    const world = createWorld(makeFlatMap(48, 20, 2, 2, [{ x: 34, y: 10 }]), {
      seed: 11,
      players: 2,
    });
    const geom = worldGeometry(world);
    const src = spawnBuilding(world, geom, geom.index(12, 10), 'guardhouse', 0);
    garrisonBuilding(src, [5, 0, 0, 0, 0]);
    const tgt = spawnBuilding(world, geom, geom.index(22, 10), 'guardhouse', 1);
    garrisonBuilding(tgt, [2, 0, 0, 0, 0]);
    recalcTerritory(world, geom);
    const before = soldierTotal(world, 0);

    applyCommand(world, { type: 'attack', player: 0, targetBuildingId: tgt.id, soldiers: 3 });
    run(world, 5); // attackers are on the road
    applyCommand(world, { type: 'demolish', player: 1, node: tgt.node });
    run(world, 3000); // marchers arrive at nothing and must walk home

    // Pre-fix the three marchers were storeFree'd on arrival (total drops to 2).
    expect(soldierTotal(world, 0)).toBe(before);
  });

  it('demolishing an own military building returns its garrison to the pool', () => {
    const world = createWorld(makeFlatMap(30, 30, 2, 2), { seed: 12, players: 1 });
    const geom = worldGeometry(world);
    const gh = spawnBuilding(world, geom, geom.index(12, 12), 'guardhouse', 0);
    garrisonBuilding(gh, [2, 1, 0, 0, 0]);
    const before = soldierTotal(world, 0);
    expect(before).toBeGreaterThanOrEqual(3);

    applyCommand(world, { type: 'demolish', player: 0, node: gh.node });
    run(world, 2);

    // Pre-fix the per-rank garrison counts died with the building object.
    expect(soldierTotal(world, 0)).toBe(before);
  });
});

describe('workers are never silently deleted', () => {
  it('demolishing a staffed producer returns its worker to the idle pool', () => {
    const world = createWorld(makeFlatMap(20, 20, 5, 5), { seed: 13, players: 1 });
    const geom = worldGeometry(world);
    const node = geom.index(8, 5); // inside HQ territory (radius 9)
    const b = spawnBuilding(world, geom, node, 'woodcutter', 0);
    expect(connectToHq(world, geom, node)).not.toBeNull();
    world.players[0].workers[JOB.woodcutter] = 1;
    run(world, 200); // recruit + walk HQ -> flag -> door
    expect(b.workerId).toBeGreaterThanOrEqual(0);
    expect(world.players[0].workers[JOB.woodcutter]).toBe(0);
    const workerId = b.workerId;

    applyCommand(world, { type: 'demolish', player: 0, node });
    run(world, 1);

    // Pre-fix the worker settler was deleted without repaying the pool, so the
    // profession (and the tool spent recruiting it) leaked on every demolish.
    expect(world.players[0].workers[JOB.woodcutter]).toBe(1);
    expect(world.settlers.items[workerId]).toBeNull();
  });
});

describe('captures do not absorb rival attackers', () => {
  it("a third player's waiting soldier is not merged into the capturer's garrison", () => {
    // P0 owns the contested guardhouse; P1 (close) and P2 (farther) both attack.
    const world = createWorld(
      makeFlatMap(48, 24, 2, 2, [
        { x: 34, y: 12 },
        { x: 44, y: 20 },
      ]),
      { seed: 13, players: 3 },
    );
    const geom = worldGeometry(world);
    const tgt = spawnBuilding(world, geom, geom.index(22, 12), 'guardhouse', 0);
    garrisonBuilding(tgt, [1, 0, 0, 0, 0]);
    const src1 = spawnBuilding(world, geom, geom.index(16, 12), 'guardhouse', 1);
    garrisonBuilding(src1, [2, 0, 0, 0, 0]);
    const src2 = spawnBuilding(world, geom, geom.index(19, 16), 'guardhouse', 2);
    garrisonBuilding(src2, [0, 0, 0, 0, 2]);
    recalcTerritory(world, geom);
    const before1 = soldierTotal(world, 1);
    const before2 = soldierTotal(world, 2);

    // One attacker each: after the capture the guardhouse has spare capacity,
    // so a co-waiting rival soldier would be absorbed pre-fix.
    applyCommand(world, { type: 'attack', player: 1, targetBuildingId: tgt.id, soldiers: 1 });
    applyCommand(world, { type: 'attack', player: 2, targetBuildingId: tgt.id, soldiers: 1 });

    const died = [0, 0, 0];
    for (let i = 0; i < 6000; i++) {
      for (const e of tickWorld(world)) {
        if (e.type === 'SoldierDied') died[e.player]++;
      }
    }

    // Conservation for BOTH attackers (whichever captures first): every
    // soldier is in the pool, a garrison of an own building, alive on the
    // map, or died in a duel (with an event). Pre-fix the co-waiting rival
    // was silently absorbed into the capturer's garrison, so one side's sum
    // came up short with no death event.
    expect(soldierTotal(world, 1) + died[1]).toBe(before1);
    expect(soldierTotal(world, 2) + died[2]).toBe(before2);
  });
});

describe('flags do not split foreign roads', () => {
  it('placing a flag on an ex-enemy road leaves the enemy road intact', () => {
    // P1 builds a road on its own land; the land then changes hands to P0.
    const world = createWorld(makeFlatMap(40, 20, 2, 2, [{ x: 30, y: 10 }]), {
      seed: 21,
      players: 2,
    });
    const geom = worldGeometry(world);
    claimArea(world, geom, 18, 8, 30, 12, 1);
    const a = geom.index(20, 10);
    const b = geom.index(26, 10);
    applyCommand(world, { type: 'placeFlag', player: 1, node: a });
    applyCommand(world, { type: 'placeFlag', player: 1, node: b });
    tickWorld(world);
    expect(connectRoad(world, geom, a, b, 1)).toBeTruthy();
    tickWorld(world);
    const roadsBefore = [...storeLive(world.roads)].filter((r) => r.player === 1);
    expect(roadsBefore.length).toBe(1);
    const interior = roadsBefore[0].path[2]; // an interior node of P1's road

    // The frontier moves: P0 now owns the road's land and flags the interior.
    claimArea(world, geom, 18, 8, 30, 12, 0);
    applyCommand(world, { type: 'placeFlag', player: 0, node: interior });
    tickWorld(world);
    const flagId = world.flagAtNode[interior];
    expect(flagId).toBeGreaterThanOrEqual(0);

    // Pre-fix the enemy road was split into two P1 halves terminating at P0's
    // flag (wiring the economies together). Now it stays one untouched road.
    const roadsAfter = [...storeLive(world.roads)].filter((r) => r.player === 1);
    expect(roadsAfter.length).toBe(1);
    expect(roadsAfter[0].path).toEqual(roadsBefore[0].path);
    for (const r of roadsAfter) {
      expect(r.flagA).not.toBe(flagId);
      expect(r.flagB).not.toBe(flagId);
    }
  });
});

describe('non-contiguous HQ slots', () => {
  it('seeds every declared HQ slot, not just the first N', () => {
    const map = makeFlatMap(40, 20, 4, 10);
    map.hq_x = [4, 0xffff, 34, 0xffff, 0xffff, 0xffff, 0xffff];
    map.hq_y = [10, 0xffff, 10, 0xffff, 0xffff, 0xffff, 0xffff];
    const world = createWorld(map, { seed: 31 });

    // Pre-fix: wanted = validHqs.length = 2, so slot 2's real HQ was never
    // seeded and a phantom HQ-less player 1 took its place.
    expect(world.players.length).toBe(3);
    expect(world.players[0].hqBuildingId).toBeGreaterThanOrEqual(0);
    expect(world.players[2].hqBuildingId).toBeGreaterThanOrEqual(0);
  });
});

describe('coin toggle applies to in-flight coins', () => {
  it('a coin already at the door flag is rejected after coins are toggled off', () => {
    const world = createWorld(makeFlatMap(30, 20, 2, 2), { seed: 32, players: 1 });
    const geom = worldGeometry(world);
    const gh = spawnBuilding(world, geom, geom.index(12, 10), 'guardhouse', 0);
    garrisonBuilding(gh, [2, 0, 0, 0, 0]);
    expect(gh.coinsEnabled).toBe(true);

    // A coin parked on the door flag, already targeted at the guardhouse.
    const flag = world.flags.items[gh.flagId]!;
    const wid = storeAlloc(world.wares, (id) => ({
      id,
      type: 'coins',
      loc: 'flag' as const,
      locId: gh.flagId,
      targetBuildingId: gh.id,
      nextFlag: -1,
    }));
    flag.wares.push(wid);

    applyCommand(world, { type: 'toggleCoins', player: 0, buildingId: gh.id, enabled: false });
    run(world, 5);

    // Pre-fix tryDeliver's generic input branch absorbed the coin anyway and
    // runPromotion later consumed it. Now the toggle is honored end to end.
    expect(gh.inputStock[0] ?? 0).toBe(0);
    const w = world.wares.items[wid];
    if (w) expect(w.targetBuildingId).not.toBe(gh.id);
  });
});

describe('harbor completion claims territory', () => {
  it('recalculates ownership the moment a built harbor starts working', () => {
    // Flat map with a west water strip; the HQ is far from the harbor spot.
    const map = makeFlatMap(40, 20, 30, 10);
    const world = createWorld(map, { seed: 33, players: 1 });
    const geom = worldGeometry(world);
    // Paint columns 0..3 water on both triangle layers (0x05 = navigable).
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x <= 3; x++) {
        const i = geom.index(x, y);
        world.terrain1[i] = 0x05;
        world.terrain2[i] = 0x05;
      }
    }
    // Hand the build corridor to player 0 (recalc later rederives ownership).
    claimArea(world, geom, 4, 8, 31, 12, 0);
    const spot = geom.index(4, 10);
    placeBuildingAndTick(world, spot, 'harbor');
    expect(connectToHq(world, geom, spot)).toBeTruthy();
    tickWorld(world);

    const probe = geom.index(4, 15); // inside HARBOR_RADIUS, outside HQ reach
    expect(ownerAt(world, probe)).toBe(-1);

    let completedAt = -1;
    for (let i = 0; i < 20000 && completedAt < 0; i++) {
      for (const e of tickWorld(world)) {
        if (e.type === 'BuildingCompleted') completedAt = world.tick;
      }
    }
    expect(completedAt).toBeGreaterThan(0);
    // Pre-fix nothing recalculated territory on completion, so the harbor
    // claimed no land until some unrelated event triggered a recalc.
    expect(ownerAt(world, probe)).toBe(0);
  }, 60_000);
});

describe("capture cuts the loser's roads at the flag", () => {
  it("the old owner's roads no longer feed a captured building's flag", () => {
    // P0 guardhouse (strong) near P1's guardhouse, which P1 wired to its HQ.
    const world = createWorld(makeFlatMap(48, 20, 2, 2, [{ x: 40, y: 10 }]), {
      seed: 41,
      players: 2,
    });
    const geom = worldGeometry(world);
    const tgt = spawnBuilding(world, geom, geom.index(26, 10), 'guardhouse', 1);
    garrisonBuilding(tgt, [1, 0, 0, 0, 0]);
    recalcTerritory(world, geom);
    // P1's supply road from its HQ flag to the guardhouse door flag.
    const hq1 = world.buildings.items[world.players[1].hqBuildingId]!;
    const hqFlagNode = world.flags.items[hq1.flagId]!.node;
    const doorFlagNode = world.flags.items[tgt.flagId]!.node;
    expect(connectRoad(world, geom, hqFlagNode, doorFlagNode, 1)).toBeTruthy();
    tickWorld(world);
    const feeding = [...storeLive(world.roads)].filter(
      (r) => r.player === 1 && (r.flagA === tgt.flagId || r.flagB === tgt.flagId),
    );
    expect(feeding.length).toBe(1);

    // P0 captures the guardhouse.
    const src = spawnBuilding(world, geom, geom.index(20, 10), 'guardhouse', 0);
    garrisonBuilding(src, [0, 0, 0, 0, 3]);
    recalcTerritory(world, geom);
    applyCommand(world, { type: 'attack', player: 0, targetBuildingId: tgt.id, soldiers: 2 });
    let captured = false;
    for (let i = 0; i < 4000 && !captured; i++) {
      for (const e of tickWorld(world)) {
        if (e.type === 'BuildingCaptured' && e.toPlayer === 0) captured = true;
      }
    }
    expect(captured).toBe(true);

    // Pre-fix P1's road survived with flagB = the now-P0 flag, so P1's
    // carriers kept delivering into P0's building. Now the road is cut.
    const stillFeeding = [...storeLive(world.roads)].filter(
      (r) => r.player === 1 && (r.flagA === tgt.flagId || r.flagB === tgt.flagId),
    );
    expect(stillFeeding.length).toBe(0);
  });
});
