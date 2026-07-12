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

## A. Performance (review; engine tick + render hot paths)

- Dispatch en-route census: `enRoute` in
  `packages/engine/src/systems/dispatch.ts` scans every live ware once per
  candidate building per tick (O(buildings x wares)). Build one per-tick
  census Map instead - the pattern already exists as `transitCensus` in
  `systems/production.ts`.
- Bounded harvester searches: `nearestReachable`/`nearestResource` in
  `packages/engine/src/systems/production.ts` scan every map node per idle
  worker per tick although targets sit within radius 2-8. Enumerate the
  (2r+1)^2 neighbourhood and add a "nothing found" cooldown (a depleted mine
  currently rescans the full map every tick).
- Ware route caching: `runDispatch` re-runs `chooseWareRoute` (full A* over
  the flag graph) for every flag-parked ware every tick. Cache per-ware
  routes and invalidate via a road-graph version counter bumped on road
  build/demolish.
- Frame-loop dirty gating: `packages/app/src/game/main.ts` rebuilds
  `roadSegments`/`upgradedRoadSegments`, the disconnected-building flood
  fill, and depleted-mine markers every animation frame (even paused). Gate
  them behind the existing dirty-flag pattern (`staticsDirty` et al.).
- Allocation-free distance: `Geometry.distance` in
  `packages/engine/src/geometry.ts` allocates 18 throwaway arrays per call
  inside the innermost A*/territory loops. Hoist the invariant cube
  conversion and use scalar math; give `neighbours()` a reusable scratch
  array.
- Sprite torus sweep: `SpriteRenderer.render` in
  `packages/renderer/src/sprites.ts` walks the full statics+dynamics lists
  once per 3x3 torus offset per frame. Reject whole offsets against the
  viewport first and pool QuadItems.
- Bounded visibility discs: `visibleNodes` in `packages/engine/src/index.ts`
  scans all map nodes per HQ/military building on every territory event.
  Enumerate bounded discs around each point; the same fix applies to
  `recalcTerritory` in `systems/territory.ts`.
- Parallel boot loads: `boot()` in `packages/app/src/game/main.ts` awaits
  five map-independent atlas loads sequentially; use `Promise.all`.

## B. Fidelity vs the original (reference-study; retrobox unblocks capture)

- Options screen: missing entirely (only a menu-level music toggle exists).
- Main-menu completeness and order: add World Campaign, Resume last game,
  Credits, and Quit entries; hide the dev Asset inspector behind a flag.
- Custom hand cursor: the browser cursor is shown today.
- Save UI decision: original 11-slot model with the ornamented dialog frame
  vs the current named REST saves - decide, then implement or document.
- Capture the remaining original screens with retrobox
  (`../retrobox/docs/automation.md`): unlimited-play setup, Options,
  Credits, HUD, build menu, building info, minimap, statistics, ware
  window, in-game Esc menu. Feeds every item above.

## C. Features (PLAN.md polish backlog, still open; audited 2026-07-12)

- Sprite-based in-game UI from IO.LST (windows, icon build menu) - panels
  are DOM elements today.
- Terrain edge blending + water/lava palette animation.
- Palette-exact gouraud lighting from GOU*.DAT
  (`packages/renderer/src/mesh.ts` ships an approximation).
- Per-nation border-stone sprites (single fixed sprite today).
- AI: catapult play; AI: seafaring (no ship/harbor references in
  `packages/engine/src/ai/`).
- Storehouse-local inventories (`Player.wares` is one global pool).
- Gold-edition extra chains: vineyard/winery, charburner (`BUILDING_DEFS`
  lacks them).
- World Campaign (Gold second campaign) mission set - `campaign-data.ts` is
  Roman-only (MISS200-209).
- Original combat/sea sound-id verification.

Landed since the PLAN.md backlog was written: donkey roads + road upgrade,
geologists, ground ware-stack sprites, soldier rank overlays + fight
animations, wasteland/winter terrain rules, harbor territory recalc on
construction.

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
