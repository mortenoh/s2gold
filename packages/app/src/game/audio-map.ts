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
 * Military cues (P4): melee combat IS a positioned world sound in the original.
 * `nodeObjs/noFighting.cpp` plays a four-clip duel loop via
 * `playNOSound(<index>, ...)` — 103 attack swing, 101 block/clash, 105 hit, 104
 * death cry (numeric constants only; no code copied). Two of our military cues
 * are now researched FACTS from those call sites:
 *
 *   103  fight attack swing  noFighting.cpp playNOSound(103,...)  (FightStarted)
 *   104  soldier death cry   noFighting.cpp playNOSound(104,...)  (SoldierDied)
 *
 * We emit one FightStarted per duel, so we collapse the loop to its leading
 * attack swing (103) — the same one-shot-per-event simplification used for the
 * continuous worker actions. The clips characterise as expected: 103 is a short
 * bright swing/impact (0.17s), 104 is a longer low, noisy death groan (0.63s).
 *
 * The other two military cues have NO positioned world sound in the original:
 * `nofCatapultMan.cpp` plays nothing (the catapult building only draws the arm
 * on the roof, `buildings/nobUsual.cpp`), and building capture (`nofAttacker`)
 * plays nothing — the original signals those via UI / postbox messages, not
 * world SFX. We keep them voiced as DOCUMENTED CHOICES so combat feedback stays
 * audible, each an installed SOUND.LST clip chosen to fit the event:
 *
 *   74  catapultFire      low ~150Hz release/boom (0.85s) — reads as a throw
 *   87  buildingCaptured  short bright noise burst (0.16s) — a "taken" sting
 *
 * Seafaring cues (P7): also NO positioned world sound in the original.
 * `nodeObjs/noShip.cpp` plays no `playNOSound`; ship/expedition events surface
 * through UI / postbox messages, not world SFX. All four sea cues therefore
 * remain DOCUMENTED CHOICES, voiced with distinct installed clips so the events
 * are still audible on the map:
 *
 *   84  shipBuilt        mid, noisy (0.69s)     — construction-flavoured
 *   66  expeditionReady  short high blip (0.08s) — a ready ping
 *   90  expeditionLanded bright noise (0.28s)    — splash-flavoured
 *   67  shipArrived      long low ~256Hz (1.06s) — horn/wash-flavoured
 *
 * Verified against Return-to-the-Roots `master` via the GitHub code-search API:
 * `playNOSound` appears only in the worker `figures/nof*.cpp`, `noFighting.cpp`
 * and `noFire.cpp` — never in the catapult, ship or attacker sources. The index
 * space was sanity-checked against the known-good worker anchors (nofWoodcutter
 * 53/85, nofStonemason 56) before trusting the combat numbers.
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
  // Military: fightClash/soldierDied are researched facts (noFighting.cpp);
  // buildingCaptured/catapultFire are documented choices (no world SFX in the
  // original). See module header.
  fightClash: 103,
  soldierDied: 104,
  buildingCaptured: 87,
  catapultFire: 74,
  // Seafaring (documented choices; no world SFX in the original — see header).
  shipBuilt: 84,
  expeditionReady: 66,
  expeditionLanded: 90,
  shipArrived: 67,
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
    case 'ShipBuilt': {
      const node = world.buildings.items[e.buildingId]?.node;
      return node === undefined ? null : { id: SOUND.shipBuilt, node };
    }
    case 'ExpeditionReady': {
      const node = world.buildings.items[e.harborId]?.node;
      return node === undefined ? null : { id: SOUND.expeditionReady, node };
    }
    case 'ExpeditionLanded':
      return { id: SOUND.expeditionLanded, node: e.node };
    case 'ShipArrived': {
      const node = world.buildings.items[e.harborId]?.node;
      return node === undefined ? null : { id: SOUND.shipArrived, node };
    }
    default:
      return null;
  }
}
