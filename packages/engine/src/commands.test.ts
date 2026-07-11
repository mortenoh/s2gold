import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  buildingAt,
  canPlaceBuilding,
  canPlaceFlag,
  createWorld,
  flagAt,
  GREENLAND_RULES,
  ownerPlayer,
  OWNER_NONE,
  terrainBuildable,
  tickWorld,
  worldGeometry,
  BUILDING,
} from './index';
import { makeFlatMap } from './harness';

describe('flag placement rules', () => {
  it('rejects flags closer than the minimum spacing', () => {
    const world = createWorld(makeFlatMap(16, 16, 1, 1), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const a = geom.index(6, 8);
    applyCommand(world, { tick: 0, player: 0, type: 'placeFlag', node: a });
    tickWorld(world);
    expect(flagAt(world, a)).not.toBeNull();

    // Adjacent node is too close.
    expect(canPlaceFlag(world, geom, GREENLAND_RULES, geom.neighbour(a, 'E'))).toBe(false);
    // Two steps away is allowed.
    expect(canPlaceFlag(world, geom, GREENLAND_RULES, geom.index(8, 8))).toBe(true);
  });
});

describe('building placement rules', () => {
  it('allows a hut on buildable meadow but not on a flag node', () => {
    const world = createWorld(makeFlatMap(16, 16, 1, 1), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    // An owned node clear of the HQ core: placing a flag on it must then block a
    // building there (the flag now occupies the node).
    const spot = geom.index(6, 6);
    expect(canPlaceBuilding(world, geom, GREENLAND_RULES, spot, BUILDING.woodcutter)).toBe(true);

    applyCommand(world, { tick: 0, player: 0, type: 'placeFlag', node: spot });
    tickWorld(world);
    expect(canPlaceBuilding(world, geom, GREENLAND_RULES, spot, BUILDING.woodcutter)).toBe(false);
  });

  it('rejects buildings on non-buildable terrain', () => {
    const world = createWorld(makeFlatMap(16, 16, 1, 1), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const spot = geom.index(8, 8);
    // Paint the node's own up-triangle as water (id 0x05).
    world.terrain1[spot] = 0x05;
    expect(terrainBuildable(world, geom, GREENLAND_RULES, spot)).toBe(false);
    expect(canPlaceBuilding(world, geom, GREENLAND_RULES, spot, BUILDING.woodcutter)).toBe(false);
  });
});

describe('placement is restricted to the acting player\'s own territory', () => {
  // Two HQs on a flat 30x30 map: player 0 around (6,6), player 1 around (20,6),
  // HQ_RADIUS=9. That leaves each HQ's disc owned, the far corners neutral, and
  // the opposite disc enemy-owned — the three ownership cases we need to assert.
  function twoPlayerWorld(): ReturnType<typeof createWorld> {
    const map = makeFlatMap(30, 30, 6, 6);
    return createWorld(
      {
        ...map,
        players: 2,
        hq_x: [6, 20, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
        hq_y: [6, 6, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
      },
      { seed: 1, players: 2 },
    );
  }

  // First node owned by `owner` (-1 = neutral) that is otherwise buildable
  // terrain (ownership ignored), avoiding the crowded HQ core so a hut fits.
  function findNode(
    world: ReturnType<typeof createWorld>,
    geom: ReturnType<typeof worldGeometry>,
    owner: number,
  ): number {
    for (let n = 0; n < geom.size; n++) {
      if (ownerPlayer(world.owner[n]) !== owner) continue;
      if (!canPlaceBuilding(world, geom, GREENLAND_RULES, n, BUILDING.woodcutter)) continue;
      return n;
    }
    return -1;
  }

  it('rejects a building on neutral or enemy land but allows it on owned land', () => {
    const world = twoPlayerWorld();
    const geom = worldGeometry(world);
    const owned = findNode(world, geom, 0);
    const neutral = findNode(world, geom, -1);
    const enemy = findNode(world, geom, 1);
    expect(owned).toBeGreaterThanOrEqual(0);
    expect(neutral).toBeGreaterThanOrEqual(0);
    expect(enemy).toBeGreaterThanOrEqual(0);

    // Terrain alone (no player) accepts all three — proving the only difference is
    // ownership, not the meadow BQ.
    expect(canPlaceBuilding(world, geom, GREENLAND_RULES, neutral, BUILDING.woodcutter)).toBe(true);

    expect(canPlaceBuilding(world, geom, GREENLAND_RULES, owned, BUILDING.woodcutter, 0)).toBe(true);
    expect(canPlaceBuilding(world, geom, GREENLAND_RULES, neutral, BUILDING.woodcutter, 0)).toBe(false);
    expect(canPlaceBuilding(world, geom, GREENLAND_RULES, enemy, BUILDING.woodcutter, 0)).toBe(false);
  });

  it('execPlaceBuilding refuses an unowned node but builds on owned land', () => {
    const world = twoPlayerWorld();
    const geom = worldGeometry(world);
    const owned = findNode(world, geom, 0);
    const neutral = findNode(world, geom, -1);

    applyCommand(world, { player: 0, type: 'placeBuilding', node: neutral, buildingType: BUILDING.woodcutter });
    tickWorld(world);
    expect(buildingAt(world, neutral)).toBeNull();

    applyCommand(world, { player: 0, type: 'placeBuilding', node: owned, buildingType: BUILDING.woodcutter });
    tickWorld(world);
    expect(buildingAt(world, owned)?.type).toBe(BUILDING.woodcutter);
  });

  it('rejects a flag on neutral or enemy land but allows it on owned land', () => {
    const world = twoPlayerWorld();
    const geom = worldGeometry(world);
    // Owned/neutral/enemy flag spots: any owned/neutral/enemy node clear of the HQ.
    let owned = -1;
    let neutral = -1;
    let enemy = -1;
    for (let n = 0; n < geom.size; n++) {
      if (!canPlaceFlag(world, geom, GREENLAND_RULES, n)) continue;
      const o = ownerPlayer(world.owner[n]);
      if (o === 0 && owned < 0) owned = n;
      else if (o === -1 && neutral < 0) neutral = n;
      else if (o === 1 && enemy < 0) enemy = n;
    }
    expect(owned).toBeGreaterThanOrEqual(0);
    expect(neutral).toBeGreaterThanOrEqual(0);
    expect(enemy).toBeGreaterThanOrEqual(0);

    expect(canPlaceFlag(world, geom, GREENLAND_RULES, owned, 0)).toBe(true);
    expect(canPlaceFlag(world, geom, GREENLAND_RULES, neutral, 0)).toBe(false);
    expect(canPlaceFlag(world, geom, GREENLAND_RULES, enemy, 0)).toBe(false);

    // The command path agrees: a flag never lands on neutral land.
    applyCommand(world, { player: 0, type: 'placeFlag', node: neutral });
    tickWorld(world);
    expect(flagAt(world, neutral)).toBeNull();
    applyCommand(world, { player: 0, type: 'placeFlag', node: owned });
    tickWorld(world);
    expect(flagAt(world, owned)).not.toBeNull();
  });

  it('refuses a road whose path leaves the player\'s territory', () => {
    const world = twoPlayerWorld();
    const geom = worldGeometry(world);
    const hq = world.buildings.items[world.players[0].hqBuildingId]!;
    const hqFlagNode = world.flags.items[hq.flagId]!.node;

    // A standalone flag four steps east of the HQ flag, all inside the owned disc.
    let fNode = hqFlagNode;
    for (let i = 0; i < 4; i++) fNode = geom.neighbour(fNode, 'E');
    applyCommand(world, { player: 0, type: 'placeFlag', node: fNode });
    tickWorld(world);
    expect(flagAt(world, fNode)).not.toBeNull();

    const road = [hqFlagNode, ...geom.lineWalk(hqFlagNode, fNode)];
    // Punch a neutral hole in an interior road node: the road must now be refused.
    const hole = road[2];
    world.owner[hole] = OWNER_NONE;
    applyCommand(world, { player: 0, type: 'buildRoad', path: road });
    tickWorld(world);
    expect([...world.roads.items].some((r) => r && r.path.includes(hole))).toBe(false);

    // Heal the territory and the identical road is accepted (control).
    world.owner[hole] = world.owner[hqFlagNode];
    applyCommand(world, { player: 0, type: 'buildRoad', path: road });
    tickWorld(world);
    expect([...world.roads.items].some((r) => r && r.path.includes(hole))).toBe(true);
  });
});

describe('ware transport and carrier hand-off', () => {
  it('carries a spawned ware over a road into the HQ store', () => {
    const world = createWorld(makeFlatMap(20, 20, 3, 3), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const hq = world.buildings.items[world.players[0].hqBuildingId]!;
    const hqFlagNode = world.flags.items[hq.flagId]!.node;
    expect(flagAt(world, hqFlagNode)).not.toBeNull();

    // A flag a few steps east, connected by a straight road.
    let fNode = hqFlagNode;
    for (let i = 0; i < 4; i++) fNode = geom.neighbour(fNode, 'E');
    applyCommand(world, { tick: 0, player: 0, type: 'placeFlag', node: fNode });
    tickWorld(world);
    const walk = geom.lineWalk(hqFlagNode, fNode);
    const road = [hqFlagNode, ...walk];
    applyCommand(world, { tick: world.tick, player: 0, type: 'buildRoad', path: road });
    tickWorld(world);

    const flag = flagAt(world, fNode)!;
    const before = world.players[0].wares.stone;
    applyCommand(world, { tick: world.tick, player: 0, type: 'cheatSpawnWare', flag: flag.id, wareType: 'stone', count: 3 });

    let carrierSeen = false;
    // A carrier now walks the realistic 20 GF/edge (CONSTANTS.md §4), so this
    // 4-edge road shuttle needs a larger tick budget than the old placeholder
    // (6 GF/edge) timing: first ware ~120 GF, each further ware ~160 GF.
    for (let i = 0; i < 700; i++) {
      tickWorld(world);
      if (world.roads.items.some((r) => r && r.carrierId >= 0)) carrierSeen = true;
      if (world.players[0].wares.stone >= before + 3) break;
    }
    expect(carrierSeen).toBe(true);
    expect(world.players[0].wares.stone).toBe(before + 3);
  });
});

describe('freeing a mid-carry carrier does not orphan its ware', () => {
  // Count live wares still marked 'carried' but whose carrier is gone (or no
  // longer holds them) — the leak this guards against.
  function orphanCarriedWares(world: ReturnType<typeof createWorld>): number {
    let n = 0;
    for (const w of world.wares.items) {
      if (w && w.loc === 'carried') {
        const s = world.settlers.items[w.locId];
        if (!s || s.carryingWareId !== w.id) n++;
      }
    }
    return n;
  }

  // Build HQ -> straight 4-edge road east to a standalone flag, spawn a ware on
  // the far flag, and tick until a carrier is mid-carry (carrying the ware back
  // toward the HQ). Returns the road path and the carried ware id.
  function setupMidCarry(): {
    world: ReturnType<typeof createWorld>;
    geom: ReturnType<typeof worldGeometry>;
    road: number[];
    fNode: number;
    wareId: number;
  } {
    const world = createWorld(makeFlatMap(20, 20, 3, 3), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const hq = world.buildings.items[world.players[0].hqBuildingId]!;
    const hqFlagNode = world.flags.items[hq.flagId]!.node;

    let fNode = hqFlagNode;
    for (let i = 0; i < 4; i++) fNode = geom.neighbour(fNode, 'E');
    applyCommand(world, { tick: 0, player: 0, type: 'placeFlag', node: fNode });
    tickWorld(world);
    const road = [hqFlagNode, ...geom.lineWalk(hqFlagNode, fNode)];
    applyCommand(world, { tick: world.tick, player: 0, type: 'buildRoad', path: road });
    tickWorld(world);

    const flag = flagAt(world, fNode)!;
    applyCommand(world, { tick: world.tick, player: 0, type: 'cheatSpawnWare', flag: flag.id, wareType: 'stone', count: 1 });

    let wareId = -1;
    for (let i = 0; i < 700 && wareId < 0; i++) {
      tickWorld(world);
      for (const s of world.settlers.items) {
        if (s && s.carryingWareId >= 0) {
          wareId = s.carryingWareId;
          break;
        }
      }
    }
    expect(wareId).toBeGreaterThanOrEqual(0);
    return { world, geom, road, fNode, wareId };
  }

  it('re-homes the carried ware onto a flag when a flag splits its road', () => {
    const { world, road, wareId } = setupMidCarry();
    const target = world.wares.items[wareId]!.targetBuildingId;

    // Drop a flag on the road's middle node: splitRoadsAt frees the carrier.
    applyCommand(world, { tick: world.tick, player: 0, type: 'placeFlag', node: road[2] });
    tickWorld(world);

    const w = world.wares.items[wareId];
    expect(w).not.toBeNull();
    expect(w!.loc).toBe('flag'); // back in circulation, not stuck on a dead settler
    expect(w!.targetBuildingId).toBe(target); // still routed to the same building
    const onFlag = [...world.flags.items].some((f) => f && f.wares.includes(wareId));
    expect(onFlag).toBe(true);
    expect(orphanCarriedWares(world)).toBe(0);
  });

  it('re-homes the carried ware when its road flag is demolished', () => {
    const { world, fNode, wareId } = setupMidCarry();

    // Demolish the far flag the carrier's road anchors: execDemolishFlag frees it.
    applyCommand(world, { tick: world.tick, player: 0, type: 'demolish', node: fNode });
    tickWorld(world);

    // The ware re-homes onto the surviving HQ flag; from there dispatch delivers
    // it into the HQ store (or it waits on the flag) — either way it is never a
    // 'carried' token pointing at a freed carrier.
    const w = world.wares.items[wareId];
    if (w) expect(w.loc).not.toBe('carried');
    expect(orphanCarriedWares(world)).toBe(0);
  });
});
