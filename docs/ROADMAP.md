# Roadmap

The single source of truth for planned s2gold work. `PLAN.md` is the
historical phase record (P0-P7 all shipped and gate-verified);
`reference-study/NOTES.md` is the raw study log against the original game.
Sections are in rough priority order; items within a section are ordered by
expected impact.

Sources: the PLAN.md polish backlog (audited against the code 2026-07-12),
the reference-study gap list, and the 2026-07-11/12 full code review
(findings below marked "review" were confirmed against the code; the
correctness findings from that review are already fixed).

## A. Performance (landed 2026-07-12)

The whole batch shipped, each change verified bit-identical against the
previous engine via long-run world-hash traces (~40% higher tick throughput
on a modest demo economy; the census/route wins grow with economy size):
per-tick en-route census for dispatch, radius-bounded harvester/mine
searches, memoised ware-route plans per sea context, bounded discs for
territory recalc and visibility, allocation-free `Geometry.distance` +
scratch-array A* expansion, per-tick app overlay caches, parallel boot
atlas loads, and torus-offset viewport rejection in the sprite pass.

Remaining:

- Pool QuadItems in `packages/renderer/src/sprites.ts` (a fresh object per
  drawn quad per frame survives; the offset rejection removed the bulk).

## B. Fidelity vs the original (reference-study)

Landed 2026-07-12 (captures in `reference-study/captures/`, notes in
`reference-study/NOTES.md`): Options screen, Credits screen, the original
title-menu order with Resume last game (newest save via ?resume=1), the
dev Asset inspector behind ?dev=1, and captures of the original's Options,
Load dialog (11 trays), World Campaign globe, Credits, HUD, and build
window. "Quit program" is deliberately omitted (no browser equivalent).

Remaining:

- Custom hand cursor: blocked on a RESOURCE.DAT converter (the cursor
  sprites are not in the converted asset set).
- Save UI decision: original 11-slot tray dialog (see captures/loadgame.png)
  vs the current named REST saves - decide, then implement or document.
- World Campaign globe screen (captures/worldcampaign.png) as a fidelity
  upgrade over the chapter list.
- Remaining captures: HQ inventory window (click the building body),
  statistics, ware window, the real in-game menu, Esc menu.

## C. Features (PLAN.md polish backlog, still open; audited 2026-07-12)

- Sprite-based in-game UI from IO.LST (windows, icon build menu) - panels
  are DOM elements today.
- Per-nation border-stone sprites (single fixed sprite today).
- AI: seafaring (no ship/harbor references in `packages/engine/src/ai/`).
- Storehouse-local inventories (`Player.wares` is one global pool).
- Gold-edition extra chains: vineyard/winery, charburner (`BUILDING_DEFS`
  lacks them).
- Original combat/sea sound-id verification.
- Per-nation border stones and the Gold extra chains (vineyard/charburner)
  are blocked: all players are Roman today and the extra-chain sprites do
  not exist in the original assets - revisit with multi-nation support.

Landed since the PLAN.md backlog was written: donkey roads + road upgrade,
geologists, ground ware-stack sprites, soldier rank overlays + fight
animations, wasteland/winter terrain rules, harbor territory recalc on
construction, AI catapult play (2026-07-12), the World Campaign mission
set (2026-07-12), palette-exact gouraud lighting + water/lava palette
animation (2026-07-12), and terrain edge blending (2026-07-12).

## D. Code health (review)

- Versioned save migrations: `packages/engine/src/serialize.ts` back-patches
  new fields ad hoc under a frozen `WORLD_VERSION = 1`, and the military
  fields (garrison/occupied/coinsEnabled) were never back-patched. Bump the
  version per schema change with a migration table.
- Attack-rules view helper: `GameSession.attackableSoldiers`
  (`packages/app/src/game/session.ts`) re-implements `execAttack`'s
  gathering rules and has already diverged (engine accepts HQ targets, the
  copy does not). Export a view helper from the engine next to `execAttack`.
- Panel shell dedupe: `military-ui.ts` and `harbor-ui.ts` copy the same
  open/close/refresh/button scaffolding byte for byte.
- Map-preview colors: `packages/app/src/menu/minimap.ts` has its own
  terrain-color table that disagrees with the map format (0x05 water drawn
  as meadow) and ignores landscape. Use the renderer's exported
  `minimapColor`/landscape tables (`packages/renderer/src/terrain-data.ts`).
- `makeBuilding` factory: ~6 sites hand-write the full Building literal
  (`world.ts`, `commands.ts`, `systems/seafaring.ts`, `harness-economy.ts`,
  app `session.ts`, which also clones the unexported `storeAlloc`).
- Delete dead exports: `roadsThrough`, `settlersInRect`, `getToolPriority`,
  `getTransportPriority`, `shipView`, `BUILDING_OUTPUT`, `BUILDING_WORKER`,
  `SAWMILL_PLANKS_PER_TRUNK`, `SAWMILL_INPUT_CAP`, `roadCarrier`,
  `isHeadquarters`, unused re-exports (`roadBetween`, `roadConnects`,
  `waterNeighbours`).
- e2e dedupe: shared `isBenign` console filter (the menu and smoke copies
  have already drifted) and a shared campaign `PROGRESS_KEY` constant.
- Python: `convert/maps.py` and `convert/terrain.py` inline
  `json.dumps` writes - use `core.write_json` like the other converters.
- Trim the unread half of the `window.__s2debug` surface (roughly half its
  ~50 members are read by no test).

## E. Infra

- GitHub Actions is configured but blocked on winterop-com org billing;
  every job passes locally.
- The engine determinism gate runs on the synthetic flat map in CI; the
  real-map variant needs locally converted assets.
