import { describe, expect, it } from 'vitest';
import type { GameEvent, World } from '@s2gold/engine';
import { SOUND, soundForEvent } from './audio-map';

/**
 * The set of SOUND.LST item indices the converter emitted into
 * public/assets/sfx/index.json (checked in). Every SOUND id must be a real clip
 * in this set, or the cue would resolve to a missing file at runtime. Kept as a
 * hardcoded literal (no gitignored-asset reads in unit tests) — refresh this if
 * the converted SOUND.LST set ever changes.
 */
const SOUND_LST_INDICES = new Set<number>([
  51, 52, 53, 54, 55, 56, 57, 58, 59, 61, 62, 64, 65, 66, 67, 68, 69, 70, 72, 74, 76, 77, 78, 81,
  82, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 98, 99, 100, 101, 102, 103, 104, 105, 107,
  108, 109, 110, 111, 112, 113, 114,
]);

describe('SOUND clip ids', () => {
  it('every mapped id is a real SOUND.LST clip', () => {
    for (const [name, id] of Object.entries(SOUND)) {
      expect(SOUND_LST_INDICES.has(id), `${name}=${id} missing from SOUND.LST`).toBe(true);
    }
  });

  it('pins the researched combat facts (noFighting.cpp)', () => {
    // Facts from RttR nodeObjs/noFighting.cpp playNOSound call sites.
    expect(SOUND.fightClash).toBe(103); // attack swing
    expect(SOUND.soldierDied).toBe(104); // death cry
  });
});

/** Minimal World stub exposing only the buildings lookup soundForEvent reads. */
function worldWith(buildings: Record<number, { node: number }>): World {
  return { buildings: { items: buildings } } as unknown as World;
}

describe('soundForEvent', () => {
  it('voices a fight at its node with the attack swing', () => {
    const e = {
      type: 'FightStarted',
      node: 42,
      attackerPlayer: 0,
      attackerRank: 0,
      defenderPlayer: 1,
      defenderRank: 0,
    } as GameEvent;
    expect(soundForEvent(e, worldWith({}))).toEqual({ id: 103, node: 42 });
  });

  it('voices a soldier death at its node', () => {
    const e = { type: 'SoldierDied', node: 7, player: 0, rank: 1 } as GameEvent;
    expect(soundForEvent(e, worldWith({}))).toEqual({ id: 104, node: 7 });
  });

  it('resolves the catapult cue at the target building node', () => {
    const e = {
      type: 'CatapultFired',
      buildingId: 1,
      targetBuildingId: 2,
      player: 0,
      hit: true,
    } as GameEvent;
    expect(soundForEvent(e, worldWith({ 1: { node: 10 }, 2: { node: 20 } }))).toEqual({
      id: SOUND.catapultFire,
      node: 20,
    });
  });

  it('returns null for events without a sound', () => {
    const e = { type: 'FlagPlaced', node: 3 } as unknown as GameEvent;
    expect(soundForEvent(e, worldWith({}))).toBeNull();
  });
});
