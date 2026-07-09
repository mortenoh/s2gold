import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  canPlaceBuilding,
  canPlaceFlag,
  createWorld,
  flagAt,
  GREENLAND_RULES,
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
    const spot = geom.index(8, 8);
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
