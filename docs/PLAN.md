# Settlers 2 Gold — Browser Clone: Implementation Plan

Companion to `docs/FEASIBILITY.md` (read that first). Codename: **s2gold**.

## Guiding principles

1. **Asset-free repo.** Assets are produced locally by `make install`, which asks for
   the path to the user's GOG installer `.exe`, extracts it (innoextract) and converts
   everything into a git-ignored static assets directory. Extraction never happens in
   the browser; by the time the app runs, assets are ready.
2. **Deterministic simulation.** Fixed-tick, integer-only, seeded RNG, command-queue
   input. The sim runs headless in Node — every gameplay feature is testable without a
   browser, and N-ticks→state-hash golden tests catch regressions.
3. **Playable at every milestone.** Each phase ends with something you can click and a
   Playwright-verified demo (screenshot + behavioral assertions).
4. **Clean room.** Implement from prose specs (settlers2.net) and extracted facts
   (offsets, constants, timings — uncopyrightable). Never copy/transliterate RttR
   (GPL) code.

## Key references

- Format specs: https://settlers2.net/documentation/ (LST, LBM, BBM, IDX/DAT, WLD/SWD,
  objects, gouraud/lighting article)
- Reference parser (facts only): `libsiedler2` — `src/Load*.cpp`, `src/XMIDI_TrackConverter.cpp`
- Gameplay constants (facts only): `s25client/libs/s25main/gameData/` — BuildingConsts,
  JobConsts, MilitaryConsts, GoodConsts; `figures/` for unit state machines
- Map format (independent): https://github.com/Merri/map-generator/wiki/WLD-&-SWD-File-Format
- XMIDI spec: https://www.vgmpf.com/Wiki/index.php/XMI (+ AIL XMIDI doc in wildmidi)
- Architectural precedent: https://github.com/tomsoftware/Settlers.ts (Settlers 4 remake
  in TS reading original files)

## Stack

- **Asset pipeline: Python 3.13+, typer CLI, uv-managed**, lint/type config following
  the chapkit conventions (`~/dev/chap-sdk/chapkit`: ruff, mypy, pyright, pytest).
  Shells out to system `innoextract`, `fluidsynth`, `ffmpeg` (all verified installed;
  the CLI checks and reports missing tools). Pillow via `uv add` for image output.
- **Game: TypeScript (strict)**, pnpm workspaces, Vite, ESLint + Prettier
- **Rendering:** WebGL2 (terrain mesh w/ vertex-color gouraud, sprite batching); UI from
  original `IO.LST`/`FONT14.FNT` assets on an overlay canvas/DOM hybrid
- **Audio:** WebAudio playing pre-converted files — SFX as WAV, music pre-rendered
  to MP3 at install time (XMID → SMF in Python, then fluidsynth + free GM soundfont
  such as GeneralUser GS, downloaded by `make install`, git-ignored; MP3 chosen over
  OGG so Safari can play it natively — see `format-notes/CONTRACTS.md`)
- **Testing:** pytest (pipeline), Vitest (engine/renderer units), Playwright MCP +
  `@playwright/test` (E2E), golden-image tests for converters against real extracted data

## Repo layout

```
s2gold/
  Makefile               install (extract+convert), dev, serve, test, e2e
  docs/                  FEASIBILITY.md, PLAN.md, GUIDE.md, format-notes/,
                         gameplay-notes/, engine-notes/, reference-study/
  src/s2gold/            Python typer CLI (uv project, root pyproject.toml)
    formats/             lst, bob/datidx, bitmaps, lbm/iff, wld, xmidi, gametext,
                         gouraud, palette readers
    convert/             converters (palettes, terrain, pics, graphics, ui, bobs,
                         fonts, maps, texts, audio, video) + atlas packer
    server/              FastAPI app: built frontend, /assets, /api (saves, sessions)
  tests/                 pytest golden tests (asset-dependent ones skip if no
                         extracted data)
  packages/
    engine/              deterministic sim: map, pathfinding, economy, military; zero DOM
    renderer/            WebGL2 terrain + sprites + minimap
    app/                 Vite shell + game loop glue + DOM UI (game/, menu/, ui/);
                         serves public/assets
  packages/app/public/assets/   (gitignored) pipeline output: atlases, JSON, WAV/MP3
  e2e/                   Playwright specs
  extracted/             (gitignored) innoextract output
```

## Workstreams

### A. Asset pipeline (Python typer CLI; critical path)

`s2gold install --installer <path-to-gog-exe>` (wrapped by `make install`):

1. Verify tool deps; run `innoextract` into `extracted/`.
2. Parse LST containers → decode bitmap types (raw, RLE, player-color, shadow) →
   PNG atlases + JSON metadata (offsets `nx,ny`, sizes, animation groups, player-color
   masks) per nation and per category.
3. LBM/BBM terrain + palettes (PoC done), GOU shading tables → JSON/LUT textures,
   WLD/SWD maps → JSON/binary, GER/ENG + RTX texts → JSON, FNT fonts → atlas.
4. BOB decoder (carrier/settler composited body-part animations) — fiddliest format;
   golden-image tests.
5. Sounds: raw PCM → WAV; music: XMID → SMF → fluidsynth render → MP3; optional
   SMK intro → MP4 (H.264) via ffmpeg.
6. Idempotent, versioned output manifest so the app can verify asset completeness.

Subcommands for dev: `s2gold inspect <file>`, `s2gold convert <category>`, `s2gold verify`.

### B. Engine (deterministic sim, TypeScript)

- Triangular map grid (the S2 dual-triangle lattice), node properties (terrain, height,
  objects, resources, ownership/borders, fog).
- Entities: flags, roads, buildings, settlers (state machines), wares.
- Systems in dependency order: construction → road network + carrier dispatch → ware
  routing (flag-to-flag, priority lists) → production chains → storage/warehouses →
  tools & new-settler recruitment → military (occupation, borders, attack, ranks,
  catapults) → seafaring (harbors, expeditions) → win conditions/objectives.
- Command pattern for all player input; savegames = serialized state (own format).

### C. Renderer + UI

- Terrain mesh w/ slope lighting from GOU tables, texture-per-triangle, edge blending;
  smooth scroll, map wrap-around; sprite pass with row z-sorting; minimap.
- Original UI recreation: main menu, in-game HUD, build menu, building windows,
  distribution/transport priority windows, statistics.

### D. Audio

- SFX trigger table (which sound at which event/animation frame), positional volume;
  music playlist (pre-rendered MP3s) per documented track order; volume settings.

## Progress (updated 2026-07-09)

All planned phases P0 through P7 are implemented and gate-verified: asset pipeline
(`make install`), terrain renderer, playable economy with build UI and carriers,
full production chains through coins, positional sound + music, military
(territory, combat, catapults, fog of war), save/load via the FastAPI server,
title/setup/campaign menus with original art, deterministic AI opponents with an
in-game statistics panel, seafaring (harbors, ships, expeditions) with its browser
UI, the Roman campaign with briefings/objectives/victory flow, and the intro video.

Since that update, the following backlog items have also landed: donkey roads and
road upgrade, geologists, ground ware-stack sprites, soldier rank overlays and
fight animations, wasteland/winter terrain rules, and harbor territory recalc on
construction. Open work is tracked in `../ROADMAP.md`.

## Phases & milestone gates

| Phase  | Deliverable                                                                                   | Gate (Playwright-verified)                                                            |
| ------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **P0** | Repo scaffold, CI, `make install` end-to-end: exe → extracted → all assets converted          | Asset inspector page shows atlases, palettes, a WLD map dump; pytest + Vitest green   |
| **P1** | Terrain renderer + map loading + scrolling + minimap                                          | Screenshot of MISS200 ("Off we go") map matches reference; 60 fps pan                 |
| **P2** | Flags, roads, HQ, carriers, construction, wood/stone/sawmill loop, in-game HUD                | E2E: place woodcutter via UI → tree felled → plank reaches construction site          |
| **P3** | Full economy (all chains, distribution, tools, recruitment), sound FX                         | E2E: bread chain (farm→mill→bakery→miner) produces gold coins headlessly + in browser |
| **P4** | Military: territory, occupation, attack, ranks, catapults; fog of war                         | Headless battle sim matches documented combat rules; E2E attack flow                  |
| **P5** | Music playback, menus with original art, save/load, statistics                                | E2E: track plays (audio element state assert); save→reload→identical state hash       |
| **P6** | AI opponent (build planner + expansion + attack heuristics)                                   | AI beats a passive player on a small map headlessly                                   |
| **P7** | Ships/harbors/expeditions, campaign missions (RTX objectives, briefings), intro video, polish | Campaign chapter 1 completable; Gold "world campaign" maps load                       |

P2 is the "soul of the game" gate (roads + carriers); if it feels right, everything
above it is mechanical.

## Testing strategy

- **Pipeline:** pytest against the real extracted data (counts, dimensions, golden PNG
  hashes); tests skip gracefully when `extracted/` is absent (CI without assets).
- **Sim:** headless scenario tests (spawn economy, run N ticks, assert stocks) +
  determinism hash (same seed+commands → identical state hash across runs/platforms).
- **E2E:** Playwright drives the real app per phase gate; screenshot comparisons for
  renderer; console-error budget = 0.
- **Playtest:** Morten sanity-checks feel (carrier behavior, pacing) at P2/P3/P4.

## Process

- Implementation is delegated to **Opus 4.8 subagents** (per Morten): one agent per
  well-scoped work item (e.g. "BOB decoder + tests", "carrier dispatch system"), with
  format notes/spec extracts prepared in `docs/format-notes/` so agents don't need to
  re-research. Fable orchestrates, reviews every diff, and owns architecture and
  phase gates.
- git repo with `.gitignore` covering `extracted/`, `*.exe`, `*.gog`, converted assets,
  and soundfonts. Nothing copyrighted ever enters history.

## Open scope decisions (defaults chosen, override anytime)

1. **Free-play first, campaign at P7** — "unlimited play" on the WORLDS maps is the
   fastest route to a playable game. (Default: yes)
2. **Multiplayer: out of scope** — determinism keeps lockstep possible later. (Default: yes)
3. **Nation for early phases: Romans** — all 4 nation sprite sets convert in P0, but
   gameplay art wiring starts with Romans (campaign nation). (Default: yes)
4. **Map editor: out of scope** (S2EDIT equivalent) unless requested later.

## What's needed from Morten

Nothing for assets — the installer covers everything. Later: playtest feedback at the
P2/P3/P4 gates, and a veto/confirm on the four scope defaults above.
