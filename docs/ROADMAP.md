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

## B. Fidelity vs the original (reference-study)

Landed 2026-07-12 (captures in `reference-study/captures/`, notes in
`reference-study/NOTES.md`): Options screen, Credits screen, the original
title-menu order with Resume last game (newest save via ?resume=1), the
dev Asset inspector behind ?dev=1, and captures of the original's Options,
Load dialog (11 trays), World Campaign globe, Credits, HUD, and build
window. "Quit program" is deliberately omitted (no browser equivalent).

Landed 2026-07-12 (part 2): original 11-slot save trays (captures/
loadgame.png), QuadItem pooling, in-game captures, clicking a warehouse
building (HQ/storehouse) opens its inventory window with hover tooltips,
the decorative statue viewport frame from RESOURCE.DAT (corner
caryatids), a compact bottom-center HUD bar (replacing the heavy
full-width top navbar) with panels/dropdowns opening upward, and the
original hand cursor (ui/handa.png) on the game canvas and menus.

Remaining:

- World Campaign globe screen (captures/worldcampaign.png): blocked on
  per-chapter marker coordinates, which are not in the converted data.
- URL scheme: replace `/play/game.html?map=<name>` with a clean,
  refreshable route like `/game/<map>/<session-id>`, backed by
  server-side session state (so a refresh restores the live game, not
  just the map). Needs a server sessions API + client wiring.

## Gameplay fidelity (observed 2026-07-12)

- Workers and construction travel should follow the road network, not
  cut straight across terrain. Today a building's builder/worker walks
  the free lattice A* (`findWalkPath`) to the site; the original routes
  them over roads (a site with no road connection cannot be staffed or
  supplied). Harvesters legitimately leave the road to reach their work
  spot (a woodcutter walking to a tree is correct), so the fix is
  specifically: builder-to-site and settler-to-building travel should be
  road-constrained. Engine change; verify against the original first.

## C. Features (PLAN.md polish backlog, still open; audited 2026-07-12)

- Sprite-based in-game UI: the statue frame, bottom HUD, hand cursor, and
  window chrome (title bars/borders/body on all panels + the build menu)
  have landed. Remaining: swap the build menu's text categories for the
  original's building-icon grid, and use the real icon sprites on the HUD
  bar buttons.
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
