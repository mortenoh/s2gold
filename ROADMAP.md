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

Landed 2026-07-14: World Campaign globe screen
(docs/reference-study/captures/worldcampaign.png) at `/campaign/world`. The
green marble backdrop (setup990) with the colour-keyed world map (world.png)
centred on it, the selected mission's continent brightened/gold-tinted and
marked with a pale X, and Start / Return buttons. The per-region marker data
everyone thought was missing was in fact `worldmsk.png` all along: a flat-colour
mask (one colour per continent, black ocean) whose nine region colours + pixel
centroids were extracted empirically and drive both the highlight compositing
and the X placement. Ours additionally lets the player pick a continent (mask
hit-test on click) and keeps an accessible mission strip below the map, so every
mission stays reachable by keyboard; when the map/mask art is absent the screen
degrades to the plain chapter list. The nine continents map to missions 101-109
in a documented narrative order anchored on Europe (the reference capture's
highlighted region); the eighteen missions run on `maps3_omap*`, so missions
110-118 have no continent and live in the strip only.

## Gameplay fidelity

Landed 2026-07-12: builder-to-site and settler-to-building travel is now
road-constrained (`findRoadWalkPath` over the flag/road graph). A building
with no road connection to the HQ is not staffed until one exists, matching
the original; harvester trips out to a tree/field still free-walk. The
mountain-meadow (0x12) build-quality fix also landed (it is buildable
ground in every landscape, validated against the maps' own build layer).

Landed (terrain build-quality follow-ups, both validated against the maps'
own `build` layer across all 50 shipped maps, 940032 nodes):

- Mountain-edge over-offered "Mines" fixed. `terrainMineable`
  (`packages/engine/src/commands.ts`) now requires all six triangles around
  the node to be mountain (mirroring `terrainBuildable`) instead of only the
  node's own two texture layers. Empirically this cut false mines from 23906
  to 9057 (−62%) with zero false negatives — it never rejects a node the
  build layer marks as mine. The ~9k residual is flag/nothing the build
  layer derives from height/proximity that terrain ids cannot express. The
  geologist survey (`systems/geologist.ts`) deliberately stays on the loose
  any-triangle-mountain rule: mines draw ore from a radius, so ore under a
  mountain-edge node is still mineable from a nearby interior node, and the
  original marks ore across the whole mountain surface while a separate,
  stricter check governs where a mine may sit.
- Terrain `0x06` ("buildable water") reclassified as buildable, walkable
  land. The original build layer marks it flag/house/castle (911 of 1862
  own-layer nodes are castle-buildable, never mine) and it carries
  subsurface well-water (never fish), so it is land that merely renders like
  shallow water. It moved from `DEFAULT_IMPASSABLE` into `BUILDABLE_IDS` and
  out of `NAVIGABLE_WATER_IDS` (ships must not sail it; it must not make
  neighbours coastal). Greenland-only — the one shipped map that carries it
  is maps3_omap00; winter/wasteland have zero 0x06 nodes, so the change is
  inert there. The renderer's terrain tables are unchanged (visuals stay).

## C. Features (PLAN.md polish backlog, still open; audited 2026-07-12)

- Sprite-based in-game UI: landed in full 2026-07-14 - the build menu's
  category flyouts are a grid of real building sprites (cropped from the
  loaded rom_z atlas, text fallback when assets are missing), and the six
  HUD bar buttons carry original io_dat icons (Pause hourglass, Game save
  monitor, Stats chart, Goods shelf, Zoom magnifier, Settings cog).
  Mute/Music stay text: io_dat has no faithful speaker/note glyph.
- Work animations for the remaining outdoor jobs: the five main jobs
  (woodcutter, stonemason, forester, fisher, farmer) plus the geologist
  now play their real CBOB action loops in `WORK_ANIM` (game-render.ts) -
  the geologist landed 2026-07-14 (bald grey head hammering the rock,
  ore chips flying, cbob_rom_bobs 314..329, cross-checked against RttR's
  nofGeologist "rom_bobs" offsets). Remaining gap: the builder, whose
  rom_bobs frames are a multi-posture around-the-scaffold sequence
  (279..290 / 353..356) with no single in-place loop that fits the
  simplified single-node construction model, stays on the walk-cycle
  fallback. The hunter is an in-building generator (SIMPLIFIED, no
  outdoor game hunt) so it never draws an outdoor action loop.
- Per-nation border-stone sprites (single fixed sprite today).
- AI: seafaring — landed 2026-07-14 (see the model paragraph below).
- Gold-edition extra chains: vineyard/winery, charburner (`BUILDING_DEFS`
  lacks them).
- Original combat/sea sound-id verification.
- Per-nation border stones and the Gold extra chains (vineyard/charburner)
  are blocked: all players are Roman today and the extra-chain sprites do
  not exist in the original assets - revisit with multi-nation support.

Landed 2026-07-14 (storehouse-local inventories, WORLD_VERSION 3): wares no
longer live in a single `Player.wares` pool — each warehouse-class building
(HQ, storehouse, harbor) carries its own `Building.wareStock`, and stock is
stored into and drawn from a SPECIFIC warehouse. Dispatch became a pull model
(`systems/dispatch.ts`): for each needer it draws the ware from the NEAREST
road-connected warehouse that has it in stock (distance via the memoised
flag-route cost `WareRoutePlan.cost`, tie-broken by lowest warehouse id), and a
warehouse cut off from the road network supplies nothing. Deliveries physically
credit the warehouse they were routed to (dispatch + the carrier warehouse
door). Settlers/soldiers/donkeys stay a player-global pool (a long-standing,
documented simplification — the original stores civilians in warehouses too),
but the tools/beer/sword/shield those recruits spend are now drawn from
warehouse stock (aggregate, debited nearest-id-first) so the two models stay
consistent. Expedition kits draw from the assembling harbor's own stock. The
app's HUD Goods button + Stats/AI still read the aggregate SUM over warehouses
(`warehouseTotals`), while clicking a warehouse shows THAT building's own
inventory (`session.warehouseGoodsAt`). A v2->v3 save migration dumps the old
global pool into the HQ's inventory. Production's surplus gate and the
`transitCensus` are unchanged in spirit; per-tick cost stays bounded by reusing
the existing flag-graph route memo (no per-ware full A*).

Landed 2026-07-14 (AI seafaring): the computer opponent now expands over water
using ONLY player-facing commands, via a new stateless priority cascade
(`packages/engine/src/ai/seafaring.ts`) that `ai/index.ts` runs when the land
planner yields nothing this cycle (land expansion exhausted) and the player owns
coastal territory. Model: (1) trigger — `planNextBuilding` returns null and a
cheap `ownsCoast` scan passes; (2) found a harbor — pick the coastal site inside
own territory that is road-connectable within budget AND opens a real sea
crossing (same water component as an unowned coastal target on a DIFFERENT land
component), preferring explicit `HARBOR_TEXTURE_FLAG` spots, then nearest-HQ,
then lowest node id; (3) build one shipyard on owned coast and let the normal
economy feed it boards so it spawns a ship; (4) prepare an expedition at a
harbor that is road-wired to the HQ (so the kit is deliverable) with an idle ship
and a reachable target; (5) launch — choose the largest reachable unowned
landmass (ties: nearest dock, then lowest node id), re-picking each cycle so a
spot claimed mid-assembly is abandoned; cap of one concurrent expedition. It is
fully deterministic (sorted scans, no RNG) and self-correcting (a lost
building/ship becomes the next goal again). Interaction with storehouse
inventories: a harbor is a warehouse with no input demand, so the expedition kit
never routed to it and the feature could not fill a kit by roads — the original
game routes boards/stones to the ordering harbor. `systems/dispatch.ts` now gives
a preparing (not-yet-ready) expedition its harbor a plank/stone demand for the
kit SHORTFALL, so the existing pull-model transport delivers it over roads from
the nearest warehouse; this completes the mechanic for human players too
(previously only the debug `debugGrantExpeditionSupplies` hook could fill a kit).
Proven end-to-end by `ai/ai-seafaring.test.ts` on `makeTwoIslandMap` (an AI
colonises a second island autonomously; a run-twice determinism check).
KNOWN LIMITATION / follow-up: the cascade assumes the AI already OWNS a
road-connectable, BUILDABLE coastal launch site facing an unowned island. On the
shipped 128²-scale sea maps it usually does not — the land planner only pushes
military toward a nearby ENEMY, so when the enemy is across water the AI places
no frontier military, its territory stays the HQ disc, and it never reaches a
buildable shore (many shore tiles are also non-buildable rock/beach). A
coast-directed general-expansion drive (claim territory toward the nearest
target-bearing shore, independent of an enemy) is the separable next step; it was
prototyped and deliberately NOT shipped because it could not complete a
colonisation on any shipped map within a bounded budget (occupation / road-reach
long-tail over 60+ nodes) and would have been half-working.

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
