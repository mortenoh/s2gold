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
- Per-nation border-stone sprites — landed 2026-07-14 (multi-nation phase 2;
  each people's boundary-stone sprite at archive index 0/1, player-colour base).
- AI: seafaring — landed 2026-07-14 (see the model paragraph below).
- Original combat/sea sound-id verification — landed 2026-07-14 (see the
  paragraph below).
- Multi-nation support — phase 1 (core + setup) AND phase 2 (rendering) both
  landed 2026-07-14 (see the two paragraphs below). Each player's buildings,
  flags, and border stones now draw from their own people's sprite archive.
- "Gold-edition extra chains" (vineyard/winery, charburner) — CLOSED as not
  part of the target game (2026-07-14). The extracted Gold-edition data
  carries no such sprites, files, or text-bank strings; those buildings come
  from The Settlers II: 10th Anniversary (2006) and the RttR addon set, not
  the 1996 Gold Edition this project reimplements. Nothing to build.

Landed 2026-07-14 (multi-nation core + setup, phase 1 of 2): the four S2
peoples (romans/vikings/nubians/japanese) are now a first-class engine +
setup concept. `Player.nation` rides on every player (COSMETIC — identical
roster/economy across nations, so no simulation system branches on it);
`createWorld` takes an optional slot-indexed `nations` array defaulting every
player to Roman (deterministic — variety is a setup-UI choice, not an engine
default). Serialization bumped to WORLD_VERSION 4 with a v3->v4 migration that
defaults a pre-nations save to all-Roman. The free-play setup screen grows a
per-slot people picker (human defaults Roman; AI slots default to a varied,
reproducible vikings/nubians/japanese cycle), plumbed through a compact
`?nations=rom,vik,...` URL query and the sessions API (`nations` field, null =
all-Roman, backward-compatible with stored sessions); campaign missions stay
all-Roman. A small HUD label shows the local player's people. DEFERRED to
phase 2: mapping each nation to its building/flag/settler sprite archive
(vik_z/afr_z/jap_z), per-nation border stones, and the winter W* variants.

Landed 2026-07-14 (multi-nation rendering, phase 2 of 2): each player's
buildings, construction sites, flags, and border stones now render from THEIR
nation's MBOB archive instead of everyone sharing rom_z. `nationBuildingArchive`
maps a people + landscape to its archive — romans->rom_z, vikings->vik_z,
nubians->afr_z (the original names the Nubian building family "afr"/African),
japanese->jap_z, with the W* winter twin on winter maps (wvik_z, ...). VERIFIED
sprite-index parity before wiring: the four summer archives cover every index we
render at the SAME index (border stone 0/1, flags 100..117, buildings 250+5*id
and their +2/+3 construction frames — the only shared gap is id-16's site shadow
333, absent from rom_z too), confirmed by decoding all four atlas.json index sets
and by cropping index 250/335/415/100/0 from each (distinct per-people HQ, hut,
sawmill, flag, and boundary stone in each style). `buildDynamics` takes a
per-player `nationArchiveFor(player)` resolver; `borderStoneSprites` is called
per player with its owner's archive. `main.ts` loads ONLY the archives the seated
players need (their nations + the current season's variant), in parallel and
non-fatal, falling back to the season-appropriate Roman archive when a nation
atlas is missing (never boots all eight). The build-menu icons crop from the
LOCAL player's nation atlas, so the menu previews the buildings you will place.
`__s2debug.nationArchiveOf(player)` exposes the resolved archive for tests.
CAVEAT: settler WORK animations still come from the Roman-only cbob_rom_bobs
(the only converted work-anim archive), so non-Roman workers keep Roman
work/walk figures for now; only the static building/flag/border layers are
per-nation. The `_y` MBOB archives turned out to be a pixel-identical subset of
the `_z` set (same sprites, same anchors, missing only the highest building
indices 465..535) — redundant for rendering, so we use `_z` exclusively.

Landed 2026-07-14 (combat/sea sound-id verification): the eight previously
guessed SOUND.LST ids in `packages/app/src/game/audio-map.ts` were checked
against Return-to-the-Roots `master` (GitHub code-search API + raw sources;
numeric constants only, no code copied), after confirming our index space
matches theirs via the known-good worker anchors (nofWoodcutter 53/85,
nofStonemason 56). Result: two guesses became researched FACTS and were
corrected — `fightClash` 64->103 (attack swing) and `soldierDied` 92->104
(death cry), both from `nodeObjs/noFighting.cpp`, which plays the melee duel as
a positioned world-sound loop (103 attack / 101 block / 105 hit / 104 death; we
collapse to the leading swing per FightStarted event). The remaining six stay
DOCUMENTED CHOICES because the original has NO positioned world sound for them:
`playNOSound` never appears in the catapult (`nofCatapultMan.cpp` /
`nobUsual.cpp`), attacker/capture, or ship (`noShip.cpp`) sources — those events
surface via UI/postbox messages in the original. Rather than silence them (a
feedback regression), catapultFire (74), buildingCaptured (87) and the four sea
cues (shipBuilt 84, expeditionReady 66, expeditionLanded 90, shipArrived 67)
remain voiced with installed clips, now documented as deliberate embellishments
with per-id acoustic characterisations. All ids were listen-verified via ffprobe
and a new `audio-map.test.ts` pins the two facts and asserts every mapped id is a
real SOUND.LST clip.

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
Landed 2026-07-14 (AI coast-directed expansion — the seafaring follow-up):
the cascade now FIRES on the real shipped sea maps, not just the two-island
fixture. Two changes, empirically driven by instrumenting a headless run over all
50 shipped maps:

- Bug fix (`ai/seafaring.ts` `analyzeSea`): the colonisation-target filter was
  inverted. `ownerPlayer(owner) !== OWNER_NONE` compares `ownerPlayer` (which
  returns -1 for unowned) against `OWNER_NONE` (0), so it KEPT only the AI's own
  coast and dropped every genuinely unowned island — targets were empty on every
  real map. The two-island test passed only by accident (the HQ disc pokes onto
  island B, so B's harbor spot counted as "owned coast"). Corrected to
  `world.owner[n] !== OWNER_NONE`. This alone lets the AI colonise from a coastal
  HQ (5 shipped maps where the HQ disc already touches a target-facing shore).
- Coast-directed expansion (`ai/sites.ts` new `coast` SiteBias +
  `ai/seafaring.ts`): a standing "grow toward the sea" drive. When the land
  planner is exhausted and the AI owns no harbor-capable coast, it places a cheap
  guardhouse at the frontier node nearest the nearest home-island shore that could
  host a harbor facing an unowned island (the objective), stepping the territory
  out one militaryRadius at a time — the ORIGINAL game expands aggressively by
  default, and reaching a coast needs a SEQUENCE of occupied, road-connected
  buildings, not one long road (the failed prototype's mistake). It runs strictly
  AFTER economy goals (never crowding the plank/stone/soldier chain it depends on),
  scans a bounded frontier disc, and is capped (`COAST_EXPANSION_MAX_MILITARY = 8`,
  ~50 nodes) so an out-of-reach shore stops the drive instead of sprawling. On
  inland-HQ maps the same drive runs from a cheap `hasNavigableWater` gate.

Empirical bottleneck story: over the 50 maps, 5 are colonisable from the starting
disc (bug fix suffices), 17 need expansion (home shore 9–61 nodes out; 14 of them
≤40, i.e. 1–5 guardhouse steps), and 28 have no reachable target (correctly
inert). One further real bug surfaced and was fixed: on many coasts the reachable
shore is mostly non-buildable rock/beach, so the single buildable node went to the
harbor and NO owned coast could host the shipyard — the cascade dead-ended at
"harbor but never a ship". Step 4 now keeps expanding along the coast when a
harbor exists but no shipyard site is ownable, claiming another buildable shore
node for the yard. Proven by the new `ai/ai-coastal-expansion.test.ts` (inland-HQ
AI on `makeExpansionIslandMap` expands to a shore, founds a harbor, builds a ship,
and colonises the far island; run-twice determinism) and a live 50× soak on
`maps_miss203` (the AI grew territory, founded a harbor, built ships, and landed
two expeditions by tick ~41k). Fully deterministic (sorted scans, lowest-id
tie-breaks, no RNG).

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
