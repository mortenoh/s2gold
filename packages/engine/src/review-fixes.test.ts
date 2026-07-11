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
import { makeFlatMap } from './harness';
import { garrisonBuilding, spawnBuilding } from './harness-economy';
import { recalcTerritory } from './systems/territory';
import { storeLive } from './world';

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
