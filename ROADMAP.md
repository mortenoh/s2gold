# Roadmap

The single source of truth for planned s2gold work. `docs/PLAN.md` is the
historical phase record (P0-P7 all shipped and gate-verified);
`docs/reference-study/NOTES.md` is the raw study log against the original game.
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

Landed 2026-07-12 (captures in `docs/reference-study/captures/`, notes in
`docs/reference-study/NOTES.md`): Options screen, Credits screen, the original
title-menu order with Resume last game (newest save via ?resume=1), the
dev Asset inspector behind ?dev=1, and captures of the original's Options,
Load dialog (11 trays), World Campaign globe, Credits, HUD, and build
window. "Quit program" is deliberately omitted (no browser equivalent).

Landed 2026-07-12 (part 2): original 11-slot save trays
(docs/reference-study/captures/loadgame.png), QuadItem pooling, in-game
captures, clicking a warehouse
building (HQ/storehouse) opens its inventory window with hover tooltips,
the decorative statue viewport frame from RESOURCE.DAT (corner
caryatids), a compact bottom-center HUD bar (replacing the heavy
full-width top navbar) with panels/dropdowns opening upward, and the
original hand cursor (ui/handa.png) on the game canvas and menus.

Remaining:

- World Campaign globe screen (docs/reference-study/captures/worldcampaign.png): blocked on
  per-chapter marker coordinates, which are not in the converted data.

## Gameplay fidelity

Landed 2026-07-12: builder-to-site and settler-to-building travel is now
road-constrained (`findRoadWalkPath` over the flag/road graph). A building
with no road connection to the HQ is not staffed until one exists, matching
the original; harvester trips out to a tree/field still free-walk. The
mountain-meadow (0x12) build-quality fix also landed (it is buildable
ground in every landscape, validated against the maps' own build layer).

Open (terrain build-quality, both found while fixing 0x12; validated
against the maps' own `build` layer):

- Mountain _edges_ over-offer "Mines". `terrainMineable`
  (`packages/engine/src/commands.ts`) checks only the node's own two
  texture layers, so ~2.5% of nodes (real brown mountain-edge tiles) offer
  a mine where the original's build layer marks them flag/nothing. The
  original requires the surrounding triangles to be mountain, not just the
  node's own textures. Renders brown, so it is a looseness rather than the
  green-tile bug that was fixed; low visible impact.
- Terrain `0x06` (shallow "buildable water") is castle-buildable in the
  original (build layer: ~53% castle in greenland) but is in
  `DEFAULT_IMPASSABLE` today, so we forbid building and walking on it.
  Greenland-only, ~3400 nodes across the maps.

## C. Features (PLAN.md polish backlog, still open; audited 2026-07-12)

- Sprite-based in-game UI: landed in full 2026-07-14 - the build menu's
  category flyouts are a grid of real building sprites (cropped from the
  loaded rom_z atlas, text fallback when assets are missing), and the six
  HUD bar buttons carry original io_dat icons (Pause hourglass, Game save
  monitor, Stats chart, Goods shelf, Zoom magnifier, Settings cog).
  Mute/Music stay text: io_dat has no faithful speaker/note glyph.
- Work animations for the remaining outdoor jobs (e.g. the hunter): the
  five main jobs (woodcutter, stonemason, forester, fisher, farmer) play
  their real CBOB action loops; jobs without decoded frame ranges in
  `WORK_ANIM` (game-render.ts) still use the walk-cycle-in-place fallback.
  Needs empirical frame-range decoding in cbob_rom_bobs, same method as
  the existing five.
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
