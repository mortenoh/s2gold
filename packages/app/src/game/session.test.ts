import { canPlaceBuilding, canPlaceFlag, serializeWorld, type MapJson } from '@s2gold/engine';
import { describe, expect, it } from 'vitest';
import { GameSession } from './session';

/** Minimal flat all-meadow map (buildable everywhere) for session round-trips. */
function makeFlatMap(width: number, height: number): MapJson {
  const size = width * height;
  const b64 = (fill: number): string => Buffer.from(new Uint8Array(size).fill(fill)).toString('base64');
  return {
    title: 'flat',
    width,
    height,
    terrain: 0,
    players: 1,
    hq_x: [1, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
    hq_y: [1, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
    encoding: 'base64',
    layers: {
      texture1: b64(0x08),
      texture2: b64(0x08),
      height: b64(0),
      object_type: b64(0),
      object_index: b64(0),
      resources: b64(0),
      owner: b64(0),
    },
  };
}

function newSession(): GameSession {
  return new GameSession(makeFlatMap(16, 16), 1);
}

describe('GameSession counter/stats persistence across load', () => {
  it('restores counters from a new-format save', () => {
    const a = newSession();
    // Simulate a played-out timeline: dirty a handful of counters.
    a.counters.fightsStarted = 85;
    a.counters.treesFelled = 12;
    a.counters.shipsBuilt = 3;
    const payload = JSON.parse(JSON.stringify(a.serialize()));

    const b = newSession();
    b.counters.fightsStarted = 999; // pre-load noise that must be overwritten
    b.loadWorld(payload);

    expect(b.counters.fightsStarted).toBe(85);
    expect(b.counters.treesFelled).toBe(12);
    expect(b.counters.shipsBuilt).toBe(3);
    // Untouched counters round-trip as zero, not the pre-load value.
    expect(b.counters.stonesMined).toBe(0);
  });

  it('zeroes counters when loading a bare (old-format) world', () => {
    const a = newSession();
    a.counters.fightsStarted = 85;
    // Old saves are the raw engine world with no wrapper.
    const bareWorld = JSON.parse(serializeWorld(a.world));

    const b = newSession();
    b.counters.fightsStarted = 42; // must not survive the load
    b.counters.treesFelled = 7;
    b.loadWorld(bareWorld);

    expect(b.counters.fightsStarted).toBe(0);
    expect(b.counters.treesFelled).toBe(0);
  });

  it('zeroes counters for an old wrapper save that predates counters (world+ai)', () => {
    // The 4 on-server fixtures are `{ world, ai }` with no counters/stats.
    const a = newSession();
    const legacy = { world: JSON.parse(serializeWorld(a.world)), ai: {} };

    const b = newSession();
    b.counters.fightsStarted = 85;
    b.loadWorld(legacy);

    expect(b.counters.fightsStarted).toBe(0);
    expect(b.statsTicks.length).toBe(1); // fresh baseline
  });

  it('restores the stats history graphs from a new-format save', () => {
    const a = newSession();
    // Grow some history so there is more than the single baseline sample.
    for (let i = 0; i < 300; i++) a.update(50);
    const ticksBefore = a.statsTicks.slice();
    const landBefore = a.statsSeries[0]?.land.slice() ?? [];
    expect(ticksBefore.length).toBeGreaterThan(1);
    const payload = JSON.parse(JSON.stringify(a.serialize()));

    const b = newSession();
    b.loadWorld(payload);

    expect(b.statsTicks).toEqual(ticksBefore);
    expect(b.statsSeries[0]?.land).toEqual(landBefore);
  });

  it('re-seeds a fresh stats history when loading a bare (old-format) world', () => {
    const a = newSession();
    for (let i = 0; i < 300; i++) a.update(50);
    const bareWorld = JSON.parse(serializeWorld(a.world));

    const b = newSession();
    for (let i = 0; i < 100; i++) b.update(50); // pre-load history
    b.loadWorld(bareWorld);

    // Bare loads have no stats to restore, so the panel starts from one baseline.
    expect(b.statsTicks.length).toBe(1);
    expect(b.statsSeries.length).toBe(b.playerCount);
  });
});

describe('GameSession placement preview respects territory ownership', () => {
  it('rejects a neutral (unowned) node that the raw terrain check alone would allow', () => {
    const s = newSession();
    // A node outside our territory that is otherwise terrain-buildable: the engine
    // command now rejects it (ownership), so the ownership-aware preview must too.
    let neutral = -1;
    for (let n = 0; n < s.geom.size; n++) {
      if (s.ownerOf(n) !== -1) continue; // must be neutral (unowned)
      if (!canPlaceBuilding(s.world, s.geom, s.rules, n, 'woodcutter')) continue; // terrain-only ok
      neutral = n;
      break;
    }
    expect(neutral).toBeGreaterThanOrEqual(0);
    // Terrain-only (no player) still says yes; the preview (with local player) says no.
    expect(canPlaceBuilding(s.world, s.geom, s.rules, neutral, 'woodcutter')).toBe(true);
    expect(s.canBuild(neutral, 'woodcutter')).toBe(false);
    // canFlag mirrors it: a flag also may not preview as placeable on neutral land.
    if (canPlaceFlag(s.world, s.geom, s.rules, neutral)) {
      expect(s.canFlag(neutral)).toBe(false);
    }
  });

  it('still allows a buildable node inside our own territory', () => {
    const s = newSession();
    let owned = -1;
    for (let n = 0; n < s.geom.size; n++) {
      if (s.ownerOf(n) !== s.localPlayer) continue;
      if (!s.canBuild(n, 'woodcutter')) continue;
      owned = n;
      break;
    }
    expect(owned).toBeGreaterThanOrEqual(0); // the preview still permits our own land
    expect(s.ownerOf(owned)).toBe(s.localPlayer);
  });
});
