/**
 * Clean-room mapping from engine {@link GameEvent}s to SOUND.LST clip ids.
 *
 * The clip ids below are the numeric SOUND.LST item indices the original plays
 * for each worker action, researched as FACTS from the Return-to-the-Roots
 * `figures/nof*.cpp` `SoundManager::playNOSound(<index>, ...)` call sites (the
 * numeric constants are uncopyrightable; no code was copied). Our sfx/index.json
 * is keyed by those same raw SOUND.LST indices, so the id IS the clip.
 *
 *   53  woodcutter axe chop           nofWoodcutter.cpp playNOSound(53,...)
 *   85  tree falling / crash          nofWoodcutter.cpp playNOSound(85,...)
 *   56  stonemason pickaxe on granite nofStonemason.cpp playNOSound(56,...)
 *   54  carpenter / sawmill saw       nofCarpenter.cpp  playNOSound(54+..,...)
 *   57  forester planting a sapling   nofForester.cpp   playNOSound(57,...)
 *   76  forester shovel dig           nofForester.cpp   playNOSound(76,...)
 *   59  miner pickaxe (unused in P2)  nofMiner.cpp      playNOSound(59,...)
 *   62  fisher (unused in P2)         nofFisher.cpp     playNOSound(62,...)
 *   78  builder hammer (standing)     nofBuilder.cpp    playNOSound(78,...)
 *   72  builder hammer (kneeling)     nofBuilder.cpp    playNOSound(72,...)
 *
 * Building-completion uses the builder hammer (78) as a construction cue; the
 * original has no single "done" clip in the fetched sources, so that one is a
 * documented choice rather than a researched fact. Continuous chopping/sawing
 * are approximated by their one-shot production events (we only receive discrete
 * per-tick events, not the original's animation-frame sound triggers).
 *
 * Military cues (P4): the fetched RttR sources do not expose the exact SOUND.LST
 * indices `noFighting.cpp` / `nofCatapultMan.cpp` play, so the four military
 * clips below are DOCUMENTED CHOICES (same status as builder-hammer): each is a
 * plausible clip picked from the installed SOUND.LST set for its event, not a
 * researched constant. They keep the audio layer voiced for combat without
 * copying any code.
 */

import type { GameEvent, World } from '@s2gold/engine';

/** SOUND.LST clip ids used by the game (see module header for sources). */
export const SOUND = {
  woodcutterChop: 53,
  treeFalling: 85,
  stonemason: 56,
  sawmill: 54,
  foresterPlant: 57,
  foresterDig: 76,
  builderHammer: 78,
  // Military (documented choices; see module header).
  fightClash: 64,
  soldierDied: 92,
  buildingCaptured: 87,
  catapultFire: 74,
} as const;

/** A positioned sound cue: which clip, and the map node it originates at. */
export interface SoundCue {
  readonly id: number;
  readonly node: number;
}

/**
 * Resolve the sound cue for an engine event, or null when the event has no
 * associated sound. Coded defensively: unknown event kinds fall through to
 * null so new engine events never throw here.
 */
export function soundForEvent(e: GameEvent, world: World): SoundCue | null {
  switch (e.type) {
    case 'TreeFelled':
      return { id: SOUND.treeFalling, node: e.node };
    case 'TreePlanted':
      return { id: SOUND.foresterPlant, node: e.node };
    case 'StoneMined':
      return { id: SOUND.stonemason, node: e.node };
    case 'WareProduced': {
      // Only the sawmill's saw is voiced here; trunk/stone are already voiced by
      // TreeFelled / StoneMined at the harvest site.
      if (e.wareType !== 'plank') return null;
      const node = world.buildings.items[e.buildingId]?.node;
      return node === undefined ? null : { id: SOUND.sawmill, node };
    }
    case 'BuildingCompleted':
      return { id: SOUND.builderHammer, node: e.node };
    case 'FightStarted':
      return { id: SOUND.fightClash, node: e.node };
    case 'SoldierDied':
      return { id: SOUND.soldierDied, node: e.node };
    case 'BuildingCaptured':
      return { id: SOUND.buildingCaptured, node: e.node };
    case 'CatapultFired': {
      const node =
        world.buildings.items[e.targetBuildingId]?.node ??
        world.buildings.items[e.buildingId]?.node;
      return node === undefined ? null : { id: SOUND.catapultFire, node };
    }
    default:
      return null;
  }
}
