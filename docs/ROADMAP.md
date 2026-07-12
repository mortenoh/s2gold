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

## D. Code health (landed 2026-07-12)

The whole review sweep shipped: renderer minimap tables for the setup
preview (its private palette drew water as meadow), versioned save
migrations (WORLD_VERSION 2 with a per-version table; true v1 saves now
load), the engine attackableSoldiers view shared by command and panel, the
BuildingPanel base class for the military/harbor panels, the makeBuilding
factory + exported storeAlloc, dead-export deletion, shared e2e helpers,
core.write_json in the maps/terrain converters, and the __s2debug trim.

## E. Infra

- GitHub Actions is configured but blocked on winterop-com org billing;
  every job passes locally.
- The engine determinism gate runs on the synthetic flat map in CI; the
  real-map variant needs locally converted assets.
