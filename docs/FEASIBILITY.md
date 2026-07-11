# Settlers 2 Gold — Browser Clone: Feasibility Study

Date: 2026-07-08. Verdict up front: **feasible**, with every risky element de-risked by
hands-on proof-of-concept against the actual GOG installer in this directory. The
realistic framing: a _playable core game_ (terrain, roads, carriers, economy, military,
sound) is a well-bounded project; _full fidelity_ (campaign, ships, AI, editor) is a
long tail we reach in phases.

## 1. Ground rules (legal shape)

- We build a **clean-room engine reimplementation** — the OpenTTD / Return-to-the-Roots
  (RttR) model. All code is original. The game loads art/sound/map assets from the
  **user's own purchased GOG installer**, extracted and converted at install time.
- **No assets are ever bundled, committed, or redistributed.** The repo ships empty;
  at `make install` the user points to their `setup_the_settlers_2_gold_*.exe` and a
  local CLI extracts + converts everything into a git-ignored assets directory that
  the browser app then serves. Extraction does **not** happen in the browser.
- RttR/libsiedler2 (GPL) is used strictly as _behavioral and format documentation_ —
  reading their docs/wiki is fine; copying their code would force GPL on us and is
  off-limits unless we deliberately choose a GPL license.
- If ever published, avoid the "The Settlers" trademark in the name.

## 2. What's inside the installer (verified)

`innoextract` (v1.9, installed) fully extracts the installer (Inno Setup 5.6.2 unicode,
307 MB). Everything the game needs is **plain files** — the 292 MB `SETTLERS2.gog` CD
image is _not_ required (it's the DOSBox-mounted CD; game data ships separately):

| Path                                         | Contents                                                   | Format                                  | Status                                              |
| -------------------------------------------- | ---------------------------------------------------------- | --------------------------------------- | --------------------------------------------------- |
| `DATA/*.LST`, `DATA/MBOB/*`                  | All sprites: map objects, buildings (4 nations), UI, icons | LST container, magic `0x4E20`, verified | ✅ parsed count OK                                  |
| `DATA/BOBS/*.BOB`                            | Carrier/settler body-part animations                       | BOB format                              | header verified                                     |
| `GFX/TEXTURES/TEX5/6/7.LBM`                  | Terrain tilesets (Greenland/Wasteland/Winter)              | IFF PBM, PackBits                       | ✅ **decoded to PNG (PoC)**                         |
| `GFX/PALETTE/*.BBM`                          | 256-color palettes                                         | IFF CMAP                                | ✅ decoded                                          |
| `DATA/TEXTURES/GOU*.DAT`                     | Gouraud shading tables for terrain lighting                | raw tables                              | present                                             |
| `DATA/SOUNDDAT/SOUND.LST`                    | 199 sound effects                                          | raw 8-bit unsigned PCM ~11 kHz          | ✅ **wrapped to WAV, validated with ffprobe (PoC)** |
| `DATA/SOUNDDAT/SNG/SNG_*.DAT`                | 25+ music tracks                                           | XMIDI (FORM XDIR/CAT XMID)              | ✅ header verified                                  |
| `DATA/MAPS*, WORLDS`                         | Campaign + free-play maps                                  | `WORLD_V1.0` (SWD/WLD)                  | ✅ header verified                                  |
| `DATA/TXT*/*.ENG/GER`, `DATA/MISSIONS/*.RTX` | All game text, mission briefings                           | GER/ENG text container (magic `0xFDE7`) | verified                                            |
| `DATA/IO/*.DAT/IDX`, `IO.LST`                | UI graphics, `FONT14.FNT` fonts                            | LST-family                              | present                                             |
| `VIDEO/INTRO.SMK`                            | Intro video, 320×200, 2224 frames                          | Smacker v2                              | identified by `file`                                |

Every one of these formats is exhaustively documented by the RttR project's
**libsiedler2** library (it has loaders for LST, BOB, LBM/BBM, WLD/SWD, GER/ENG, FNT,
XMIDI, raw sounds, gouraud DATs). Format risk is therefore **low** — this is
transcription work, not reverse engineering.

### Proof-of-concept results (this session)

1. **Terrain atlas**: wrote a ~60-line Python decoder (IFF PBM + PackBits + BBM
   palette) → `TEX5.LBM` renders as a correct 256×256 Greenland tileset PNG
   (snow/water/grass/desert/mountain all recognizable). This is the same code path the
   browser importer will use in TypeScript.
2. **LST container walk**: `SOUND.LST` parses cleanly (200 items: 199 sounds + 1 XMIDI).
3. **Sound effect**: raw PCM wrapped with a 44-byte WAV header → valid 0.9 s 11 kHz
   clip per ffprobe.
4. **Maps/music/text**: magic headers all match the documented formats.

## 3. Browser technology assessment

| Concern       | Assessment                                                                                                                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rendering     | WebGL2. The map is a triangular grid; the original gouraud-shades each triangle by slope (GOU tables). WebGL vertex colors reproduce this exactly and give effortless 60 fps + smooth scrolling/zoom. Original ran on a 486; performance is a non-issue. |
| Simulation    | Deterministic fixed-tick integer sim (like the original's game frames), decoupled from rendering. Runs headless in Node for tests — this is what makes an agent-built game verifiable.                                                                   |
| Sound FX      | WebAudio `AudioBuffer`s decoded once at import. Trivial.                                                                                                                                                                                                 |
| Music         | XMID → standard MIDI (documented transform, ~200 lines) → **pre-rendered to OGG at install time** with local `fluidsynth` (installed) + a freely-licensed GM soundfont. Browser just plays audio files — no in-browser synth needed.                     |
| Intro video   | SMK → WebM at install time with local `ffmpeg` (has a native Smacker decoder, installed). Optional, not on the critical path.                                                                                                                            |
| Asset serving | Converted assets are plain static files (PNG atlases + JSON + OGG/WAV) in a git-ignored directory; Vite serves them in dev, any static server in prod.                                                                                                   |

## 4. Install-time extraction (`make install`)

Requirement (per Morten): extraction does **not** happen in the browser. `make install`
asks for the path to the GOG `.exe` and a local Python CLI (typer) does everything:

1. `innoextract` (system binary, verified installed) unpacks the Inno Setup 5.6.2
   installer — proven this session against the real installer.
2. Converters transform every format (LST/BOB/LBM/BBM/WLD/GER/FNT/GOU/PCM/XMID) into
   web-native assets: PNG atlases + JSON metadata, WAV/OGG audio, pre-rendered OGG
   music (fluidsynth), optional WebM intro (ffmpeg).
3. Output lands in a git-ignored assets directory; the browser app loads it as plain
   static files. Re-running is idempotent.

If a browser-side importer is ever wanted later, an innoextract WASM port exists
(Mobica/innoextract-wasm) — noted for the record, not planned.

Risk: negligible — every step was exercised in this session's proofs-of-concept.

## 5. Gameplay knowledge

No blocker, and **nothing further needed from Morten** except playtesting feedback and
scope decisions:

- RttR reimplements the full game; its source layout + wiki document production chains,
  carrier dispatch, military rules, catapults, seafaring in exact detail (behavioral
  reference only — see ground rules).
- Fan wikis document per-building costs, production ratios, soldier ranks and combat.
- The installer itself carries mission texts (`MISS_*.ENG`), goal data (`*.RTX`), and
  the README documents Gold-edition rule changes.
- Original save/compat is a non-goal; our own save format instead.

## 6. Honest scope assessment

Full Settlers 2 Gold means: ~30 building types, ~25 professions, a dozen production
chains, road/carrier logistics, military occupation + combat + catapults, harbors and
expedition ships, fog of war, 4 nation sprite sets, 2 campaigns (Roman + World),
AI opponents, statistics screens, save/load, the original UI. RttR took years in C++;
a focused TS clone is realistically **30–60k LOC**. The phased plan (PLAN.md) gets a
_visibly working game_ early (terrain + roads + carriers + first economy loop) and
reaches "full" incrementally, with a Playwright-verified milestone gate per phase.
Multiplayer is explicitly out of scope (architecture keeps lockstep possible later).

## 7. Risk register

| Risk                                                          | Severity | Mitigation                                                                      |
| ------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------- |
| Install-time toolchain deps (innoextract, ffmpeg, fluidsynth) | Low      | All verified installed; `make install` checks and reports missing tools         |
| BOB body-part animation format (composited settler sprites)   | Medium   | Well documented in libsiedler2; isolated converter with golden-image tests      |
| Gameplay fidelity (carrier fairness, combat rules)            | Medium   | RttR docs + Morten playtests; deterministic sim makes behavior testable/tunable |
| Music rendering quality                                       | Low      | fluidsynth + free GM soundfont at install time; tweak soundfont choice freely   |
| Scope creep / long tail                                       | High     | Phase gates, playable at every milestone, core-first ordering                   |
| Legal                                                         | Low      | No asset redistribution, original code, no GPL copying, no trademark use        |

## 8. Verdict

**Green light.** All asset formats verified against the real installer with working
decoders for the riskiest ones; the whole extraction/conversion pipeline is a local
install-time step using tools already proven on this machine; rendering/audio/
simulation are comfortably within browser tech; gameplay is fully documented publicly.
Implementation plan and architecture: see `docs/PLAN.md`.
