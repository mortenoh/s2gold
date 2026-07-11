import { describe, expect, it } from 'vitest';
import {
  BUILDING,
  GREENLAND_RULES,
  SEA,
  canPlaceBuilding,
  canPlaceHarbor,
  createWorld,
  expeditionStatus,
  findWaterPath,
  harborDockNode,
  harborsOf,
  hashWorld,
  isCoastalLand,
  isWaterNode,
  ownerAt,
  shipsOf,
  tickWorld,
  worldGeometry,
  type World,
} from './index';
import { applyCommand } from './commands';
import { makeTwoIslandMap, TWO_ISLAND } from './harness';
import { spawnBuilding, connectBuildings, garrisonBuilding } from './harness-economy';
import { recalcTerritory } from './systems/territory';
import { getBuilding, getFlag, storeAlloc, storeLive, type Ship } from './world';

type Geom = ReturnType<typeof worldGeometry>;

/** Directly dock an idle ship at a harbor (bypasses shipyard construction). */
function manufactureShip(world: World, geom: Geom, harborId: number): Ship {
  const harbor = getBuilding(world, harborId);
  const dock = harborDockNode(world, geom, harbor.node);
  const id = storeAlloc(world.ships, (sid) => ({
    id: sid,
    player: harbor.player,
    node: dock,
    state: 'idle' as const,
    homeHarborId: harborId,
    destHarborId: -1,
    path: [],
    pathIndex: 0,
    edgeProgress: 0,
    ticksPerEdge: SEA.ticksPerEdge,
    cargo: [],
    expeditionTargetSpot: -1,
    expeditionBoards: 0,
    expeditionStones: 0,
    expeditionBuilder: false,
  }));
  return world.ships.items[id] as Ship;
}

describe('P7 water classification + coastal buildability', () => {
  it('recognises water nodes, coasts, and where harbors may be built', () => {
    const world = createWorld(makeTwoIslandMap(), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const harborA = geom.index(TWO_ISLAND.harborA.x, TWO_ISLAND.harborA.y);
    const waterNode = geom.index(2, 6); // open sea west of island A
    const inland = geom.index(TWO_ISLAND.hq.x, TWO_ISLAND.hq.y); // HQ, fully inland

    expect(isWaterNode(world, waterNode)).toBe(true);
    expect(isWaterNode(world, harborA)).toBe(false);
    expect(isCoastalLand(world, geom, harborA)).toBe(true);
    expect(isCoastalLand(world, geom, inland)).toBe(false);

    // A harbor fits the coastal spot but not inland or on open water.
    expect(canPlaceHarbor(world, geom, GREENLAND_RULES, harborA)).toBe(true);
    expect(canPlaceHarbor(world, geom, GREENLAND_RULES, inland)).toBe(false);
    expect(canPlaceHarbor(world, geom, GREENLAND_RULES, waterNode)).toBe(false);
    // A shipyard is coastal too; an ordinary building is not allowed at the shore.
    const shipyardSpot = geom.index(TWO_ISLAND.shipyardA.x, TWO_ISLAND.shipyardA.y);
    expect(canPlaceBuilding(world, geom, GREENLAND_RULES, shipyardSpot, BUILDING.shipyard)).toBe(
      true,
    );
    expect(canPlaceBuilding(world, geom, GREENLAND_RULES, harborA, BUILDING.woodcutter)).toBe(
      false,
    );
  });
});

describe('P7 water pathfinding', () => {
  it('is deterministic, wraps water, and refuses land goals', () => {
    const world = createWorld(makeTwoIslandMap(), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const dockA = harborDockNode(
      world,
      geom,
      geom.index(TWO_ISLAND.harborA.x, TWO_ISLAND.harborA.y),
    );
    const dockB = harborDockNode(
      world,
      geom,
      geom.index(TWO_ISLAND.harborB.x, TWO_ISLAND.harborB.y),
    );

    const p1 = findWaterPath(world, geom, dockA, dockB);
    const p2 = findWaterPath(world, geom, dockA, dockB);
    expect(p1).not.toBeNull();
    expect(p1).toEqual(p2); // determinism
    expect((p1 as number[])[p1!.length - 1]).toBe(dockB); // ends at goal

    // A route to a land node is impossible.
    const land = geom.index(TWO_ISLAND.harborB.x + 1, TWO_ISLAND.harborB.y);
    expect(findWaterPath(world, geom, dockA, land)).toBeNull();
  });
});

describe('P7 ship construction', () => {
  it('builds a ship at a coastal shipyard and docks it at a harbor', () => {
    const world = createWorld(makeTwoIslandMap(), { seed: 2, players: 1 });
    const geom = worldGeometry(world);
    const harbor = spawnBuilding(
      world,
      geom,
      geom.index(TWO_ISLAND.harborA.x, TWO_ISLAND.harborA.y),
      BUILDING.harbor,
    );
    const shipyard = spawnBuilding(
      world,
      geom,
      geom.index(TWO_ISLAND.shipyardA.x, TWO_ISLAND.shipyardA.y),
      BUILDING.shipyard,
      0,
      true, // staffed: skip the shipwright walk-in for the test
    );
    shipyard.inputStock[0] = SEA.shipPlankCost; // planks already delivered

    let built = false;
    for (let i = 0; i < SEA.shipPlankCost + 1400; i++) {
      for (const e of tickWorld(world)) if (e.type === 'ShipBuilt') built = true;
      if (built) break;
    }
    expect(built).toBe(true);
    const ships = shipsOf(world, 0);
    expect(ships).toHaveLength(1);
    expect(ships[0].homeHarborId).toBe(harbor.id);
    expect(ships[0].node).toBe(harborDockNode(world, geom, harbor.node));
  });
});

/** Build a transport scenario: two harbors, a road-connected storehouse, one ship. */
function setupTransport(seed: number): {
  world: World;
  geom: Geom;
  harborA: number;
  storehouse: number;
} {
  const world = createWorld(makeTwoIslandMap(), { seed, players: 1 });
  const geom = worldGeometry(world);
  const harborA = spawnBuilding(
    world,
    geom,
    geom.index(TWO_ISLAND.harborA.x, TWO_ISLAND.harborA.y),
    BUILDING.harbor,
  );
  const harborB = spawnBuilding(
    world,
    geom,
    geom.index(TWO_ISLAND.harborB.x, TWO_ISLAND.harborB.y),
    BUILDING.harbor,
  );
  const storehouse = spawnBuilding(
    world,
    geom,
    geom.index(TWO_ISLAND.consumerB.x, TWO_ISLAND.consumerB.y),
    BUILDING.storehouse,
  );
  recalcTerritory(world, geom); // the working harbors now project territory over island B
  connectBuildings(world, geom, harborB.node, storehouse.node); // road on island B (owned land)
  tickWorld(world); // execute the road command
  manufactureShip(world, geom, harborA.id);

  // A physical plank at harbor A's flag, bound for the island-B storehouse.
  const flag = getFlag(world, harborA.flagId);
  const wid = storeAlloc(world.wares, (id) => ({
    id,
    type: 'plank',
    loc: 'flag' as const,
    locId: flag.id,
    targetBuildingId: storehouse.id,
    nextFlag: -1,
  }));
  flag.wares.push(wid);
  return { world, geom, harborA: harborA.id, storehouse: storehouse.id };
}

describe('P7 sea ware transport', () => {
  it('ships a ware from one island to a consumer on another', () => {
    const { world } = setupTransport(3);
    const basePlank = world.players[0].wares.plank;

    let sawCargo = false;
    let delivered = false;
    for (let i = 0; i < 4000; i++) {
      tickWorld(world);
      for (const s of shipsOf(world, 0)) if (s.cargo.length > 0) sawCargo = true;
      if (world.players[0].wares.plank > basePlank) {
        delivered = true;
        break;
      }
    }
    expect(sawCargo).toBe(true); // the ship physically carried the ware across water
    expect(delivered).toBe(true); // it reached the storehouse on the far island
  });


  it('unloads stranded cargo at home when the destination harbor dies mid-voyage', () => {
    const { world, geom, harborA } = setupTransport(8);

    // Let the ship load and depart, then raze the whole destination island
    // economy (harbor B and the storehouse the ware is bound for).
    let sailing = false;
    for (let i = 0; i < 2000 && !sailing; i++) {
      tickWorld(world);
      sailing = shipsOf(world, 0).some((s) => s.cargo.length > 0);
    }
    expect(sailing).toBe(true);
    for (const b of [...harborsOf(world, 0)]) {
      if (b.id !== harborA) applyCommand(world, { player: 0, type: 'demolish', node: b.node });
    }
    const store = [...storeLive(world.buildings)].find((b) => b.type === BUILDING.storehouse);
    if (store) applyCommand(world, { player: 0, type: 'demolish', node: store.node });

    // Pre-fix the ship returned home and idled with the plank aboard forever
    // (loc='ship', en-route count inflated). Now it unloads at home.
    let unloaded = false;
    for (let i = 0; i < 4000 && !unloaded; i++) {
      tickWorld(world);
      const homeFlag = getFlag(world, getBuilding(world, harborA).flagId);
      const shipEmptyIdle = shipsOf(world, 0).every(
        (sh) => sh.state === 'idle' && sh.cargo.length === 0,
      );
      const plankBack =
        homeFlag.wares.some((wid) => world.wares.items[wid]?.type === 'plank') ||
        (world.players[0].wares.plank ?? 0) > 0;
      unloaded = shipEmptyIdle && plankBack;
    }
    expect(unloaded).toBe(true);
  });

  it('refunds and drops an expedition when its harbor is demolished', () => {
    const world = createWorld(makeTwoIslandMap(), { seed: 9, players: 1 });
    const geom = worldGeometry(world);
    const harborA = spawnBuilding(
      world,
      geom,
      geom.index(TWO_ISLAND.harborA.x, TWO_ISLAND.harborA.y),
      BUILDING.harbor,
    );
    const planks0 = world.players[0].wares.plank ?? 0;
    const stones0 = world.players[0].wares.stone ?? 0;
    const builders0 = world.players[0].workers.builder ?? 0;

    applyCommand(world, { player: 0, type: 'prepareExpedition', harborId: harborA.id });
    let ready = false;
    for (let i = 0; i < 50 && !ready; i++) {
      for (const e of tickWorld(world)) if (e.type === 'ExpeditionReady') ready = true;
    }
    expect(ready).toBe(true);
    expect((world.players[0].wares.plank ?? 0)).toBeLessThan(planks0); // kit drawn

    applyCommand(world, { player: 0, type: 'demolish', node: harborA.node });
    for (let i = 0; i < 5; i++) tickWorld(world);

    // Pre-fix the expedition entry persisted forever with its materials and
    // builder locked up. Now the kit is refunded and the entry dropped.
    expect(world.expeditions.length).toBe(0);
    expect(world.players[0].wares.plank ?? 0).toBe(planks0);
    expect(world.players[0].wares.stone ?? 0).toBe(stones0);
    expect(world.players[0].workers.builder ?? 0).toBe(builders0);
  });
});

describe('P7 expedition founding', () => {
  it('assembles a kit, sails a ship, and founds a new harbor on the far island', () => {
    const world = createWorld(makeTwoIslandMap(), { seed: 4, players: 1 });
    const geom = worldGeometry(world);
    const harborA = spawnBuilding(
      world,
      geom,
      geom.index(TWO_ISLAND.harborA.x, TWO_ISLAND.harborA.y),
      BUILDING.harbor,
    );
    manufactureShip(world, geom, harborA.id);
    const targetSpot = geom.index(TWO_ISLAND.harborB.x, TWO_ISLAND.harborB.y);

    // Prepare, then wait for the kit (boards + stones + builder) to assemble.
    applyCommand(world, { player: 0, type: 'prepareExpedition', harborId: harborA.id });
    let ready = false;
    for (let i = 0; i < 50; i++) {
      for (const e of tickWorld(world)) if (e.type === 'ExpeditionReady') ready = true;
      if (ready) break;
    }
    expect(ready).toBe(true);
    expect(expeditionStatus(world, harborA.id)?.ready).toBe(true);

    // Launch toward the far coast and wait for the landing.
    applyCommand(world, { player: 0, type: 'startExpedition', harborId: harborA.id, targetSpot });
    let landedNode = -1;
    for (let i = 0; i < 1500; i++) {
      for (const e of tickWorld(world)) if (e.type === 'ExpeditionLanded') landedNode = e.node;
      if (landedNode >= 0) break;
    }
    expect(landedNode).toBe(targetSpot);

    const harbors = harborsOf(world, 0);
    expect(harbors.some((h) => h.node === targetSpot)).toBe(true); // new colony harbor
    expect(ownerAt(world, targetSpot)).toBe(0); // territory established on the far island
    expect(expeditionStatus(world, harborA.id)).toBeNull(); // kit consumed
  });

  it('waits offshore instead of founding on a spot occupied during the voyage', () => {
    const world = createWorld(makeTwoIslandMap(), { seed: 6, players: 2 });
    const geom = worldGeometry(world);
    const harborA = spawnBuilding(
      world,
      geom,
      geom.index(TWO_ISLAND.harborA.x, TWO_ISLAND.harborA.y),
      BUILDING.harbor,
    );
    manufactureShip(world, geom, harborA.id);
    const targetSpot = geom.index(TWO_ISLAND.harborB.x, TWO_ISLAND.harborB.y);

    applyCommand(world, { player: 0, type: 'prepareExpedition', harborId: harborA.id });
    let ready = false;
    for (let i = 0; i < 50 && !ready; i++) {
      for (const e of tickWorld(world)) if (e.type === 'ExpeditionReady') ready = true;
    }
    expect(ready).toBe(true);
    applyCommand(world, { player: 0, type: 'startExpedition', harborId: harborA.id, targetSpot });
    tickWorld(world); // the ship departs

    // Mid-voyage, another player's building takes the target spot.
    const squatter = spawnBuilding(world, geom, targetSpot, BUILDING.harbor, 1);

    let landed = false;
    for (let i = 0; i < 1500 && !landed; i++) {
      for (const e of tickWorld(world)) if (e.type === 'ExpeditionLanded') landed = true;
    }

    // Pre-fix the landing overwrote buildingAtNode with a second live harbor
    // and reassigned the door flag. Now the ship waits offshore instead.
    expect(landed).toBe(false);
    expect(world.buildingAtNode[targetSpot]).toBe(squatter.id);
    const door = world.flagAtNode[geom.neighbour(targetSpot, 'SE')];
    expect(getFlag(world, door).player).toBe(1);

    // The moment the squatter is gone (building AND its leftover door flag,
    // which by design outlives the building and blocks foreign spots), the
    // waiting expedition founds normally.
    applyCommand(world, { player: 1, type: 'demolish', node: targetSpot });
    tickWorld(world);
    applyCommand(world, { player: 1, type: 'demolish', node: geom.neighbour(targetSpot, 'SE') });
    for (let i = 0; i < 200 && !landed; i++) {
      for (const e of tickWorld(world)) if (e.type === 'ExpeditionLanded') landed = true;
    }
    expect(landed).toBe(true);
    expect(harborsOf(world, 0).some((h) => h.node === targetSpot)).toBe(true);
  });

  it('refuses to found on a spot whose door flag belongs to another player', () => {
    const world = createWorld(makeTwoIslandMap(), { seed: 4, players: 2 });
    const geom = worldGeometry(world);
    const harborA = spawnBuilding(
      world,
      geom,
      geom.index(TWO_ISLAND.harborA.x, TWO_ISLAND.harborA.y),
      BUILDING.harbor,
    );
    manufactureShip(world, geom, harborA.id);
    const targetSpot = geom.index(TWO_ISLAND.harborB.x, TWO_ISLAND.harborB.y);
    const doorNode = geom.neighbour(targetSpot, 'SE');

    // Give player 1 a foothold on island B: an occupied guardhouse projects
    // territory over the target's door node so player 1 may claim the flag there.
    const p1Fort = spawnBuilding(world, geom, geom.index(17, 6), BUILDING.guardhouse, 1);
    garrisonBuilding(p1Fort, [3, 0, 0, 0, 0]);
    recalcTerritory(world, geom);

    // Player 1 claims the target's door flag before player 0 can settle there.
    applyCommand(world, { player: 1, type: 'placeFlag', node: doorNode });
    tickWorld(world);
    const foreignFlag = world.flagAtNode[doorNode];
    expect(foreignFlag).toBeGreaterThanOrEqual(0);
    expect(getFlag(world, foreignFlag).player).toBe(1);

    // Assemble player 0's kit and launch at the foreign-flagged spot.
    applyCommand(world, { player: 0, type: 'prepareExpedition', harborId: harborA.id });
    let ready = false;
    for (let i = 0; i < 50; i++) {
      for (const e of tickWorld(world)) if (e.type === 'ExpeditionReady') ready = true;
      if (ready) break;
    }
    expect(ready).toBe(true);

    applyCommand(world, { player: 0, type: 'startExpedition', harborId: harborA.id, targetSpot });
    let landed = -1;
    for (let i = 0; i < 300; i++) {
      for (const e of tickWorld(world)) if (e.type === 'ExpeditionLanded') landed = e.node;
      if (landed >= 0) break;
    }

    expect(landed).toBe(-1); // launch refused -> never lands
    expect(harborsOf(world, 0).some((h) => h.node === targetSpot)).toBe(false);
    expect(expeditionStatus(world, harborA.id)?.ready).toBe(true); // kit intact for a valid retry
  });
});

describe('P7 determinism with seafaring active', () => {
  it('produces identical world-hash sequences for the same seed', () => {
    const a = setupTransport(9);
    const b = setupTransport(9);
    const hashesA: string[] = [];
    const hashesB: string[] = [];
    for (let i = 1; i <= 1500; i++) {
      tickWorld(a.world);
      tickWorld(b.world);
      if (i % 300 === 0) {
        hashesA.push(hashWorld(a.world));
        hashesB.push(hashWorld(b.world));
      }
    }
    expect(hashesA).toEqual(hashesB);
    expect(new Set(hashesA).size).toBeGreaterThan(1); // the sim actually evolved
  });
});
