# Ticks, game speed & animation cadence (facts, cited)

Source: `github.com/Return-To-The-Roots/s25client/libs/s25main/gameData/GameConsts.h`,
`gameTypes/GameSettingTypes.h`, `figures/noFigure.cpp`, `nodeObjs/noMovable.cpp`,
`figures/nofCarrier.cpp`. Original-game framing cross-checked with settlers2.net.

---

## 1. What a "game frame" (GF) is

The Settlers II simulation advances in fixed **game frames**. All gameplay durations
(CONSTANTS.md, MILITARY.md) are counted in GF. The wall-clock length of one GF depends only
on the chosen game speed; the *logic* is identical at every speed.

`gameData/GameConsts.h`:
- `SPEED_GF_LENGTHS` (ms per GF), indexed by `GameSpeed`
  (`GameSettingTypes.h`: VerySlow, Slow, Normal, Fast, VeryFast):

| GameSpeed | ms per GF | GF per real second |
|-----------|:--:|:--:|
| VerySlow | 80 | 12.5 |
| Slow | 60 | ~16.7 |
| **Normal (reference)** | **50** | **20** |
| Fast | 40 | 25 |
| VeryFast | 30 | ~33.3 |

- `REFERENCE_SPEED = 50 ms` (Normal). RttR expresses all in-game durations relative to this
  reference (`duration_to_gfs` / `gfs_to_duration`), so **stored GF counts assume 50 ms/GF.**
- Debug/replay bounds only: `MAX_SPEED = 10 ms`, `MIN_SPEED = 80 ms`, `SPEED_STEP = 10 ms`.

### Original DOS Settlers II
The original ran its simulation at a comparable fixed step; the RttR team measured the
Normal speed at 50 ms/GF and the geometry constants (`TR_W=56`, `TR_H=28`) "from a
screenshot of the original" (`gameData/MapConsts.h`). Treat **50 ms/GF at Normal as the
authoritative timing basis**; the four other speeds are simple rescalings of the same GF
counts.

---

## 2. Mapping to the s2gold engine

`docs/engine-notes/ARCHITECTURE.md` fixes our engine at **1 GF = 50 ms = one `tick()`**.
This is exactly RttR's Normal/reference speed, so:

> **A duration of N GF in CONSTANTS.md / MILITARY.md = N engine ticks, 1:1.**

No conversion needed. To support a speed control later, keep the sim at 1 tick = 1 GF and
vary only how many ticks are stepped per real second (20 at Normal, 12.5..33.3 across the
range). Never subdivide a GF; the renderer interpolates between two states for smoothness
(RttR does the same via `GAMECLIENT.Interpolate`).

Quick reference (Normal speed) for durations used elsewhere:
| GF | seconds | example |
|:--:|:--:|---------|
| 20 | 1.0 | 1 node of flat walking |
| 148 | 7.4 | woodcutter felling a tree |
| 479 | 24.0 | sawmill cycle |
| 583 | 29.2 | miner cycle |
| 835 | 41.8 | tree growth wait per stage |
| 1050 | 52.5 | mint cycle |
| 6000 | 300 | carrier productivity window |

---

## 3. Movement & walk-animation cadence

Source `nodeObjs/noMovable.cpp StartMoving`, `figures/noFigure.cpp`.

- **Walk duration:** 20 GF per node on flat ground for every figure; uphill multiplies the
  time (×1.5 / ×2 / ×3 by slope), downhill stays 20 GF. Full slope table in
  `CONSTANTS.md` §3.
- **Walk sprite frames:** each direction has **8 walk frames**, laid out
  `imgSetIndex + dir*8 + step`, `step = 0..7`, directions start at EAST going clockwise
  (`noFigure::calcWalkFrameIndex`).
- **Frame advance while walking:** `CalcWalkAnimationFrame()` interpolates
  `ASCENT_ANIMATION_STEPS[ascent]` over the current walk event, mod 8. On flat ground the
  8 frames spread across the 20-GF step (~2.5 GF/frame ≈ 125 ms/frame at Normal). Steeper
  ascent uses a different step count (more/fewer footfalls) over the longer/shorter walk.
  A figure stopped waiting for a free node freezes on frame 2.

### Idle carrier "fidget" animations
`figures/nofCarrier.cpp`: an idle carrier plays occasional idle animations. Next idle
begins at `NEXT_ANIMATION + rand(NEXT_ANIMATION_RANDOM)` = `200 + rand(200)` GF; within an
idle animation, frames advance every `FRAME_GF = 3` GF (150 ms/frame at Normal).

### Worker "working" animations
Work animations are interpolated over the worker's `work_length` event via
`GAMECLIENT.Interpolate(frameCount, current_ev)`. Examples: woodcutter fell animation is
118 interpolation steps over its work event; forester plant = 36 steps; miner = 160 steps
(`figures/nof*.cpp`). These are renderer cadences derived from the GF work length; the sim
only needs the work-length GF count.

---

## 4. Node object growth cadences (sim events)

These are simulation timers (GF), not just visuals:
- **Tree** (`nodeObjs/noTree.h`): per growth stage, wait `WAIT_LENGTH = 835` GF then grow
  `GROWING_LENGTH = 15` GF; 3 stages from sapling (size 0) to full (size 3).
- **Grain field** (`nodeObjs/noGrainfield.cpp`): per stage, wait
  `GROWING_WAITING_LENGTH = 1100` GF then grow `GROWING_LENGTH = 16` GF; 3 stages to
  mature. Mature field withers after `3000 + rand(1000)` GF; withering fade = 20 GF.

---

## 5. Terrain palette animation (water / lava)

The animated water and lava terrains are done by **palette rotation** on a fixed set of
palette indices — a renderer effect, independent of sim state and (in the original) of game
speed. RttR drives cyclic sprite/palette animation through `GAMECLIENT.GetGlobalAnimation`
(e.g. flag banners use an 8-frame global cycle). The exact palette-rotation rate for
water/lava is **not a numeric constant in the gameData sources fetched**.

- **UNKNOWN (flagged):** exact original water/lava palette-cycle period. Best estimate:
  the classic S2 water animates at roughly **~5-7 fps** (the animated palette band shifts
  one entry every ~150-200 ms of real time). Implement as a real-time clock (not tied to
  the sim tick) at ~6 fps and adjust to taste against reference footage; the palette
  index band to rotate comes from the LBM/palette (see `docs/format-notes` palette work).

---

## 6. Source files
`gameData/GameConsts.h`, `gameData/MapConsts.h`, `gameTypes/GameSettingTypes.h`,
`nodeObjs/noMovable.cpp`, `figures/noFigure.cpp`, `figures/nofCarrier.cpp`,
`nodeObjs/noTree.h`, `nodeObjs/noGrainfield.cpp`.
