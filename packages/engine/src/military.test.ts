/**
 * Military system tests (P4 wave 1). Rules cited to docs/gameplay-notes/MILITARY.md.
 * Covers: recruitment, occupation + territory expansion, deterministic combat
 * between two players, catapult attrition, and gold-coin promotion.
 */

import { describe, expect, it } from 'vitest';
import {
  BUILDING_DEFS,
  createWorld,
  hashWorld,
  militaryView,
  ownerAt,
  tickWorld,
  worldGeometry,
  applyCommand,
  warehouseWareTotal,
  type GameEvent,
  type MapJson,
} from './index';
import { makeFlatMap } from './harness';
import { garrisonBuilding, grantWarehouse, spawnBuilding } from './harness-economy';

/** Run `n` ticks, collecting every emitted event. */
function runTicks(world: ReturnType<typeof createWorld>, n: number): GameEvent[] {
  const all: GameEvent[] = [];
  for (let i = 0; i < n; i++) all.push(...tickWorld(world));
  return all;
}

/** A flat all-meadow map with two headquarters (players 0 and 1). */
function makeFlatMap2(
  width: number,
  height: number,
  hq0: [number, number],
  hq1: [number, number],
): MapJson {
  const base = makeFlatMap(width, height, hq0[0], hq0[1]);
  return {
    ...base,
    players: 2,
    hq_x: [hq0[0], hq1[0], 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
    hq_y: [hq0[1], hq1[1], 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
  };
}

describe('military building definitions (MILITARY.md §2)', () => {
  it('encodes troop capacity, gold, armor and territory radius', () => {
    const expected = {
      barracks: { maxTroops: 2, maxGold: 1, armorCap: 1, militaryRadius: 8 },
      guardhouse: { maxTroops: 3, maxGold: 2, armorCap: 2, militaryRadius: 9 },
      watchtower: { maxTroops: 6, maxGold: 4, armorCap: 4, militaryRadius: 10 },
      fortress: { maxTroops: 9, maxGold: 6, armorCap: 6, militaryRadius: 11 },
    } as const;
    for (const [name, want] of Object.entries(expected)) {
      const def = BUILDING_DEFS[name];
      expect(def.kind).toBe('military');
      expect(def.maxTroops).toBe(want.maxTroops);
      expect(def.maxGold).toBe(want.maxGold);
      expect(def.armorCap).toBe(want.armorCap);
      expect(def.militaryRadius).toBe(want.militaryRadius);
    }
    expect(BUILDING_DEFS.catapult.kind).toBe('catapult');
  });
});

describe('soldier recruitment (MILITARY.md §6 / CONSTANTS.md §7)', () => {
  it('recruits a private from beer+sword+shield+helper when a garrison wants troops', () => {
    const world = createWorld(makeFlatMap(30, 30, 4, 4), { seed: 3, players: 1 });
    const geom = worldGeometry(world);
    const p = world.players[0];
    // Drain the starting soldier pool so demand forces a recruit.
    p.soldiers = [0, 0, 0, 0, 0];
    const beforeBeer = warehouseWareTotal(world, 0, 'beer');
    const beforeHelpers = p.workers.carrier;

    // A working guardhouse creates demand for 3 soldiers.
    spawnBuilding(world, geom, geom.index(15, 15), 'guardhouse', 0, false);
    const events = runTicks(world, 500);

    const recruited = events.filter((e) => e.type === 'SoldierRecruited');
    expect(recruited.length).toBeGreaterThanOrEqual(1);
    // The new soldier is a private (rank 0) — either still pooled or already
    // ordered out to the guardhouse.
    expect(warehouseWareTotal(world, 0, 'beer')).toBeLessThan(beforeBeer); // beer consumed
    expect(p.workers.carrier).toBeLessThan(beforeHelpers); // a Helper became a soldier
  });
});

describe('occupation + territory expansion (MILITARY.md §3)', () => {
  it('walks soldiers into a new guardhouse and expands owned territory', () => {
    const world = createWorld(makeFlatMap(40, 40, 4, 4), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const ghNode = geom.index(24, 24); // far from the HQ (radius 9) -> neutral land
    expect(ownerAt(world, ghNode)).toBe(-1); // neutral before occupation

    const gh = spawnBuilding(world, geom, ghNode, 'guardhouse', 0, false);
    expect(gh.occupied).toBe(false);

    const events = runTicks(world, 1200);

    // The guardhouse filled to capacity and activated its territory.
    const view = militaryView(world, gh.id);
    expect(view?.occupied).toBe(true);
    expect(view?.troops).toBe(3); // maxTroops for a guardhouse
    expect(events.some((e) => e.type === 'MilitaryOccupied' && e.firstOccupant)).toBe(true);
    expect(events.some((e) => e.type === 'TerritoryChanged')).toBe(true);

    // Ownership expanded: the guardhouse node and its neighbours are now ours.
    expect(ownerAt(world, ghNode)).toBe(0);
    for (const n of geom.neighbours(ghNode)) expect(ownerAt(world, n)).toBe(0);
  });
});

describe('deterministic combat between two players (MILITARY.md §4-5)', () => {
  /** Build a scripted battle world: p0 fortress attacks p1 guardhouse. */
  function battleWorld(seed: number): ReturnType<typeof createWorld> {
    const world = createWorld(makeFlatMap2(60, 20, [5, 10], [50, 10]), { seed });
    const geom = worldGeometry(world);
    // Drain both idle soldier pools so garrisons aren't auto-refilled mid-battle
    // (keeps the scripted fight self-contained).
    world.players[0].soldiers = [0, 0, 0, 0, 0];
    world.players[1].soldiers = [0, 0, 0, 0, 0];
    const fort = spawnBuilding(world, geom, geom.index(20, 10), 'fortress', 0, false);
    garrisonBuilding(fort, [3, 3, 3, 0, 0]); // 9 soldiers, mixed ranks
    const gh = spawnBuilding(world, geom, geom.index(26, 10), 'guardhouse', 1, false);
    garrisonBuilding(gh, [3, 0, 0, 0, 0]); // 3 defending privates
    // p0 sends 6 attackers (strongest first) at the guardhouse.
    applyCommand(world, { player: 0, type: 'attack', targetBuildingId: gh.id, soldiers: 6 });
    return world;
  }

  /** A compact signature of the fight outcome (deaths in order + captures). */
  function battleSignature(world: ReturnType<typeof createWorld>, ticks: number): string {
    const parts: string[] = [];
    for (let i = 0; i < ticks; i++) {
      for (const e of tickWorld(world)) {
        if (e.type === 'SoldierDied') parts.push(`d${e.player}:${e.rank}`);
        if (e.type === 'BuildingCaptured') parts.push(`cap${e.toPlayer}`);
      }
    }
    return parts.join('|');
  }

  it('same seed -> identical outcome and identical state hash', () => {
    const a = battleWorld(4242);
    const b = battleWorld(4242);
    const sigA = battleSignature(a, 800);
    const sigB = battleSignature(b, 800);
    expect(sigA).toBe(sigB);
    expect(hashWorld(a)).toBe(hashWorld(b));
    // A real battle happened (soldiers died) and the guardhouse fell.
    expect(sigA).toContain('d');
    expect(sigA).toContain('cap0');
  });

  /** An evenly matched skirmish whose outcome depends on the RNG. */
  function skirmishWorld(seed: number): ReturnType<typeof createWorld> {
    const world = createWorld(makeFlatMap2(60, 20, [5, 10], [50, 10]), { seed });
    const geom = worldGeometry(world);
    world.players[0].soldiers = [0, 0, 0, 0, 0];
    world.players[1].soldiers = [0, 0, 0, 0, 0];
    const fort = spawnBuilding(world, geom, geom.index(20, 10), 'fortress', 0, false);
    garrisonBuilding(fort, [0, 0, 4, 0, 0]); // 4 sergeants
    const gh = spawnBuilding(world, geom, geom.index(26, 10), 'guardhouse', 1, false);
    garrisonBuilding(gh, [0, 0, 3, 0, 0]); // 3 sergeants (evenly matched)
    applyCommand(world, { player: 0, type: 'attack', targetBuildingId: gh.id, soldiers: 3 });
    return world;
  }

  it('different seeds can produce different fight sequences', () => {
    const sigs = new Set<string>();
    for (const seed of [1, 2, 3, 7, 99]) {
      sigs.add(battleSignature(skirmishWorld(seed), 1200));
    }
    expect(sigs.size).toBeGreaterThan(1);
  });

  it('captures the guardhouse and flips its territory to the attacker', () => {
    const world = battleWorld(4242);
    const geom = worldGeometry(world);
    const ghNode = geom.index(26, 10);
    runTicks(world, 800);
    const b = world.buildings.items.find((x) => x && x.node === ghNode);
    expect(b?.player).toBe(0); // captured by player 0
    expect(ownerAt(world, ghNode)).toBe(0); // territory flipped
  });
});

describe('attacking a headquarters (MILITARY.md §4)', () => {
  it('razes an enemy HQ when attacked, removing its territory anchor', () => {
    const world = createWorld(makeFlatMap2(60, 20, [5, 10], [50, 10]), { seed: 7 });
    const geom = worldGeometry(world);
    world.players[0].soldiers = [0, 0, 0, 0, 0];
    world.players[1].soldiers = [0, 0, 0, 0, 0];
    const fort = spawnBuilding(world, geom, geom.index(44, 10), 'fortress', 0, false);
    garrisonBuilding(fort, [3, 3, 3, 0, 0]); // 9 soldiers
    const hqId = world.players[1].hqBuildingId;
    expect(hqId).toBeGreaterThanOrEqual(0);

    // Attack the enemy HQ directly (kind 'hq', not 'military').
    applyCommand(world, { player: 0, type: 'attack', targetBuildingId: hqId, soldiers: 3 });
    const events = runTicks(world, 800);

    let burned = false;
    let capturedByP0 = false;
    for (const e of events) {
      if (e.type === 'BuildingCaptured' && e.toPlayer === 0) {
        capturedByP0 = true;
        burned = e.burned;
      }
    }
    expect(capturedByP0).toBe(true);
    expect(burned).toBe(true); // taking the HQ razes it
    expect(world.players[1].hqBuildingId).toBe(-1); // lost its HQ anchor
    expect(world.buildings.items[hqId]).toBeNull(); // building removed
  });
});

describe('headquarters reserve defense (MILITARY.md §4)', () => {
  /** Attack player 1's HQ with p0's fortress; p1 defends only from its reserve. */
  function hqSiege(
    seed: number,
    reserve: number[],
    fortGarrison: number[],
    attackers: number,
  ): { world: ReturnType<typeof createWorld>; hqId: number } {
    const world = createWorld(makeFlatMap2(60, 20, [5, 10], [50, 10]), { seed });
    const geom = worldGeometry(world);
    world.players[0].soldiers = [0, 0, 0, 0, 0];
    grantWarehouse(world, 0, { sword: 0 }); // no recruitment to perturb counts
    grantWarehouse(world, 1, { sword: 0 });
    world.players[1].soldiers = reserve.slice(); // the HQ's only defenders
    const fort = spawnBuilding(world, geom, geom.index(44, 10), 'fortress', 0, false);
    garrisonBuilding(fort, fortGarrison);
    const hqId = world.players[1].hqBuildingId;
    applyCommand(world, { player: 0, type: 'attack', targetBuildingId: hqId, soldiers: attackers });
    return { world, hqId };
  }

  it('defends an attacked HQ from the reserve, one defender per fight', () => {
    // 3 reserve privates vs 6 strong attackers: the HQ fights its whole reserve
    // out before it can be razed.
    const { world, hqId } = hqSiege(7, [3, 0, 0, 0, 0], [3, 3, 3, 0, 0], 6);
    const parts: string[] = [];
    let razedAt = -1;
    for (let i = 0; i < 800; i++) {
      for (const e of tickWorld(world)) {
        if (e.type === 'SoldierDied' && e.player === 1) parts.push('def');
        if (e.type === 'BuildingCaptured' && e.burned && razedAt < 0) razedAt = parts.length;
      }
    }
    // All 3 reserve defenders died (came out one by one) and the HQ was razed
    // only after the reserve was exhausted.
    const defDeaths = parts.filter((p) => p === 'def').length;
    expect(defDeaths).toBe(3);
    expect(razedAt).toBe(3); // raze happened after the 3rd defender death
    expect(world.players[1].soldiers.reduce((a, c) => a + c, 0)).toBe(0);
    expect(world.players[1].hqBuildingId).toBe(-1);
    expect(world.buildings.items[hqId]).toBeNull();
  });

  it('survives the attack when its reserve defenders win', () => {
    // 2 lone privates vs a deep reserve of generals: the attackers are wiped out
    // and the HQ stands. Winning defenders return to the reserve.
    const { world, hqId } = hqSiege(7, [0, 0, 0, 0, 20], [3, 0, 0, 0, 0], 2);
    const events = runTicks(world, 800);
    const capturedByP0 = events.some((e) => e.type === 'BuildingCaptured' && e.toPlayer === 0);
    expect(capturedByP0).toBe(false);
    expect(world.players[1].hqBuildingId).toBe(hqId);
    expect(world.buildings.items[hqId]).not.toBeNull();
    // Both attackers died; the reserve only shrank by defender casualties.
    const p0deaths = events.filter((e) => e.type === 'SoldierDied' && e.player === 0).length;
    expect(p0deaths).toBe(2);
    const p1deaths = events.filter((e) => e.type === 'SoldierDied' && e.player === 1).length;
    expect(world.players[1].soldiers.reduce((a, c) => a + c, 0)).toBe(20 - p1deaths);
  });

  it('an HQ with an empty reserve falls to the first attacker with no fight', () => {
    const { world, hqId } = hqSiege(7, [0, 0, 0, 0, 0], [3, 0, 0, 0, 0], 2);
    const events = runTicks(world, 800);
    // No defender ever died (there were none) yet the HQ was razed.
    expect(events.some((e) => e.type === 'SoldierDied' && e.player === 1)).toBe(false);
    expect(events.some((e) => e.type === 'BuildingCaptured' && e.burned)).toBe(true);
    expect(world.buildings.items[hqId]).toBeNull();
  });

  /**
   * Like hqSiege, but also gives p1 an empty guardhouse near its HQ that wants
   * troops. Without the siege pause, occupation would drain p1's reserve into
   * this guardhouse on the very first tick — before the attackers arrive.
   */
  function hqSiegeWithGuardhouse(
    seed: number,
    reserve: number[],
    fortGarrison: number[],
    attackers: number,
  ): {
    world: ReturnType<typeof createWorld>;
    hqId: number;
    gh: ReturnType<typeof spawnBuilding>;
  } {
    const world = createWorld(makeFlatMap2(60, 20, [5, 10], [50, 10]), { seed });
    const geom = worldGeometry(world);
    world.players[0].soldiers = [0, 0, 0, 0, 0];
    grantWarehouse(world, 0, { sword: 0 });
    grantWarehouse(world, 1, { sword: 0 });
    world.players[1].soldiers = reserve.slice();
    const fort = spawnBuilding(world, geom, geom.index(44, 10), 'fortress', 0, false);
    garrisonBuilding(fort, fortGarrison);
    // Empty guardhouse right next to p1's HQ: reachable, understaffed, wants 3.
    const gh = spawnBuilding(world, geom, geom.index(54, 10), 'guardhouse', 1, false);
    const hqId = world.players[1].hqBuildingId;
    applyCommand(world, { player: 0, type: 'attack', targetBuildingId: hqId, soldiers: attackers });
    return { world, hqId, gh };
  }

  it('holds the reserve for HQ defense instead of occupying while besieged', () => {
    // 3 reserve generals + an empty guardhouse that wants 3. If occupation kept
    // running, the generals would walk off to the guardhouse and the HQ would be
    // razed with no fight. Pausing keeps them home to defend and win.
    const { world, hqId, gh } = hqSiegeWithGuardhouse(7, [0, 0, 0, 0, 3], [3, 0, 0, 0, 0], 2);

    // Mid-siege: attackers are still on the HQ, and the reserve has NOT drained
    // into the guardhouse (occupation is paused for this owner).
    let sieged = false;
    for (let i = 0; i < 120; i++) {
      tickWorld(world);
      if (world.settlers.items.some((s) => s && s.rank >= 0 && s.attackTargetId === hqId)) {
        sieged = true;
        expect(gh.garrison.reduce((a, c) => a + c, 0)).toBe(0);
        expect(gh.incoming).toBe(0);
      }
    }
    expect(sieged).toBe(true); // the scenario actually put the HQ under siege

    // Let the fight finish: the HQ survives (reserve defended it).
    runTicks(world, 800);
    expect(world.players[1].hqBuildingId).toBe(hqId);
    expect(world.buildings.items[hqId]).not.toBeNull();

    // Siege over: occupation resumes and the guardhouse now fills from the reserve.
    runTicks(world, 1200);
    expect(gh.garrison.reduce((a, c) => a + c, 0)).toBeGreaterThan(0);
  });

  it('is deterministic with a besieged HQ and a pending occupation', () => {
    const sig = (seed: number): string => {
      const { world } = hqSiegeWithGuardhouse(seed, [1, 1, 0, 0, 1], [3, 3, 0, 0, 0], 4);
      const parts: string[] = [];
      for (let i = 0; i < 1500; i++) {
        for (const e of tickWorld(world)) {
          if (e.type === 'SoldierDied') parts.push(`d${e.player}:${e.rank}`);
          if (e.type === 'BuildingCaptured') parts.push(`cap${e.toPlayer}`);
          if (e.type === 'MilitaryOccupied') parts.push(`occ${e.player}`);
        }
      }
      return `${parts.join('|')}#${hashWorld(world)}`;
    };
    expect(sig(909)).toBe(sig(909));
  });

  it('is deterministic: same seed -> identical outcome and state hash', () => {
    const sig = (seed: number): string => {
      const { world } = hqSiege(seed, [2, 1, 0, 0, 0], [3, 3, 0, 0, 0], 4);
      const parts: string[] = [];
      for (let i = 0; i < 800; i++) {
        for (const e of tickWorld(world)) {
          if (e.type === 'SoldierDied') parts.push(`d${e.player}:${e.rank}`);
          if (e.type === 'BuildingCaptured') parts.push(`cap${e.toPlayer}`);
        }
      }
      return `${parts.join('|')}#${hashWorld(world)}`;
    };
    expect(sig(313)).toBe(sig(313));
  });
});

describe('capture reinforcement is capped at maxTroops (MILITARY.md §4)', () => {
  it('caps a captured building at its capacity; excess attackers do not vanish', () => {
    const world = createWorld(makeFlatMap2(60, 20, [5, 10], [50, 10]), { seed: 11 });
    const geom = worldGeometry(world);
    world.players[0].soldiers = [0, 0, 0, 0, 0];
    world.players[1].soldiers = [0, 0, 0, 0, 0];
    grantWarehouse(world, 0, { sword: 0 }); // no recruitment to perturb the soldier count
    const fort = spawnBuilding(world, geom, geom.index(20, 10), 'fortress', 0, false);
    garrisonBuilding(fort, [3, 3, 3, 0, 0]); // 9 soldiers (strongest sent first)
    const bar = spawnBuilding(world, geom, geom.index(26, 10), 'barracks', 1, false);
    garrisonBuilding(bar, [2, 0, 0, 0, 0]); // 2 defending privates, maxTroops 2

    // Over-send: 6 attackers at a maxTroops-2 barracks.
    applyCommand(world, { player: 0, type: 'attack', targetBuildingId: bar.id, soldiers: 6 });
    const events = runTicks(world, 1000);

    const view = militaryView(world, bar.id);
    expect(view?.occupied).toBe(true);
    expect(world.buildings.items[bar.id]?.player).toBe(0); // captured
    // The invariant: garrison never exceeds the building's capacity.
    expect(view?.troops).toBeLessThanOrEqual(2);
    expect(view?.troops).toBeGreaterThanOrEqual(1);

    // Surviving attackers walked home rather than vanishing: player 0's total
    // soldier population is conserved apart from its own battle casualties.
    const p0deaths = events.filter((e) => e.type === 'SoldierDied' && e.player === 0).length;
    let total = world.players[0].soldiers.reduce((a, c) => a + c, 0);
    for (const b of world.buildings.items) {
      if (b && b.player === 0) total += b.garrison.reduce((a, c) => a + c, 0);
    }
    for (const s of world.settlers.items) {
      if (s && s.player === 0 && s.rank >= 0) total += 1;
    }
    expect(total).toBe(9 - p0deaths);
  });
});

describe('catapult attrition (MILITARY.md §7)', () => {
  it('throws stones that kill soldiers in a nearby enemy building', () => {
    const world = createWorld(makeFlatMap2(40, 20, [4, 10], [36, 10]), { seed: 5 });
    const geom = worldGeometry(world);
    world.players[1].soldiers = [0, 0, 0, 0, 0]; // no reinforcement for the target
    const cat = spawnBuilding(world, geom, geom.index(16, 10), 'catapult', 0, false);
    cat.inputStock = [8]; // 8 stones -> up to 8 shots (robust to RNG-stream shifts)
    const gh = spawnBuilding(world, geom, geom.index(22, 10), 'guardhouse', 1, false);
    garrisonBuilding(gh, [3, 0, 0, 0, 0]); // distance 6 < 14 -> in range

    const events = runTicks(world, 2800); // ~8 shots at 310 GF spacing

    expect(events.some((e) => e.type === 'CatapultFired')).toBe(true);
    // At least one shot killed a defender. (Asserted via events: over a long
    // run the HQ recruits replacements, so the final garrison may recover.)
    const kills = events.filter((e) => e.type === 'SoldierDied' && e.player === 1).length;
    expect(kills).toBeGreaterThan(0);
  });
});

describe('gold-coin promotion (MILITARY.md §6)', () => {
  it('consumes coins to raise soldiers one rank at a time', () => {
    const world = createWorld(makeFlatMap(30, 30, 4, 4), { seed: 8, players: 1 });
    const geom = worldGeometry(world);
    world.players[0].soldiers = [0, 0, 0, 0, 0]; // no occupation top-up
    const gh = spawnBuilding(world, geom, geom.index(15, 15), 'guardhouse', 0, false);
    garrisonBuilding(gh, [3, 0, 0, 0, 0]); // full garrison (3 privates), occupied
    gh.inputStock = [2]; // 2 gold coins in the coin store
    const coinsBefore = gh.inputStock[0];

    const events = runTicks(world, 1500);

    const promotions = events.filter((e) => e.type === 'SoldierPromoted');
    expect(promotions.length).toBeGreaterThanOrEqual(1);
    // Coins were consumed (1 per promotion event).
    expect(gh.inputStock[0]).toBeLessThan(coinsBefore);
    // Ranks rose: a soldier above private now exists.
    const view = militaryView(world, gh.id);
    const higherRanks = (view?.garrison ?? []).slice(1).reduce((a, c) => a + c, 0);
    expect(higherRanks).toBeGreaterThanOrEqual(1);
    // Garrison size is conserved (promotion moves soldiers up, never removes them).
    expect(view?.troops).toBe(3);
  });
});

describe('determinism with military activity', () => {
  it('two identical military worlds stay hash-identical over a long run', () => {
    const build = (): ReturnType<typeof createWorld> => {
      const world = createWorld(makeFlatMap2(50, 24, [5, 12], [44, 12]), { seed: 2024 });
      const geom = worldGeometry(world);
      // p0 fortress vs p1 guardhouse, plus a p0 catapult in range of p1.
      const fort = spawnBuilding(world, geom, geom.index(18, 12), 'fortress', 0, false);
      garrisonBuilding(fort, [2, 2, 2, 2, 1]);
      const cat = spawnBuilding(world, geom, geom.index(20, 14), 'catapult', 0, false);
      cat.inputStock = [4];
      const gh = spawnBuilding(world, geom, geom.index(26, 12), 'guardhouse', 1, false);
      garrisonBuilding(gh, [3, 0, 0, 0, 0]);
      applyCommand(world, { player: 0, type: 'attack', targetBuildingId: gh.id, soldiers: 4 });
      return world;
    };
    const a = build();
    const b = build();
    const hashesA: string[] = [];
    const hashesB: string[] = [];
    for (let i = 1; i <= 1500; i++) {
      tickWorld(a);
      tickWorld(b);
      if (i % 300 === 0) {
        hashesA.push(hashWorld(a));
        hashesB.push(hashWorld(b));
      }
    }
    expect(hashesA).toEqual(hashesB);
    expect(new Set(hashesA).size).toBeGreaterThan(1); // state actually evolved
  });
});
