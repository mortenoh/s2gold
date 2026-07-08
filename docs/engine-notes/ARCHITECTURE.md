# Engine architecture (deterministic simulation)

Contract for everything under `packages/engine`. Agents implementing engine systems
must follow this exactly; deviations require an orchestrator note.

## Principles

- **Pure TypeScript, zero DOM.** The engine runs identically in Node (tests) and the
  browser. No `Date.now`, no `Math.random`, no floats in simulation state.
- **Fixed tick.** One game frame (GF) = 50 ms nominal. `tick()` advances exactly one
  GF. Rendering interpolates between states visually; the sim never subdivides ticks.
- **Integer state only.** Positions are node ids + edge progress counters. Durations
  are tick counts. Percentages are 0..255 bytes. Floats may appear only in
  renderer-facing view helpers, never in serialized state.
- **Seeded RNG in state.** PCG32 (or xorshift128) implemented in the engine; the RNG
  state serializes with the world. Any system needing randomness draws from it in a
  fixed order.
- **Command queue.** All player input is a `Command { tick, player, type, payload }`.
  Commands apply at the start of their tick, sorted by (tick, player, seq). This gives
  replays, save/load consistency, and future lockstep multiplayer.
- **Determinism gate.** `hashState(world)` = FNV-1a over the canonical serialization.
  Test: same map + same seed + same command script, run twice (and run
  serialized/deserialized mid-way) => identical hash every N ticks.

## World model

```
World {
  tick, rngState, width, height,
  nodes:      per-node arrays (terrain1/2, height, object, resource, owner, flags below)
  flags:      Flag { id, node, player, wares: WareSlot[] (max 8) }
  roads:      Road { id, path: nodeId[], player, carrierId?, quality (normal|water later) }
  buildings:  Building { id, type, node, player, state (site|working...), progress, stock, workerId? }
  settlers:   Settler { id, job, player, state machine fields, location (node|road+progress) }
  wares:      Ware { id, type, location (flag slot|carried|building), targetBuildingId? }
  players:    Player { hqBuildingId, inventory: counts per ware/job type }
}
```

- Dense arrays + free lists; iteration in id order only (deterministic).
- Node indexing: `y * width + x`; triangular lattice geometry (odd rows shifted
  right half a step; neighbours E/W/NE/NW/SE/SW with parity rules — same rules the
  renderer uses, implemented independently in `engine/src/geometry.ts` with tests).

## Tick pipeline (fixed order)

1. Apply due commands (build flag/road/building, demolish, etc.).
2. Construction sites consume delivered material, advance with builder present.
3. Production buildings advance work cycles (P2: woodcutter, forester, sawmill, quarry).
4. Settler state machines step (walking has ticks-per-edge by job; carrying, working).
5. Ware routing: pathfind ware hops flag->flag toward target; carriers pick up wares
   on their road segment (S2 rule: carrier serves one road segment, fetches from the
   flag with more queued wares first).
6. Emit events (append-only per-tick list): SpriteMoved is NOT an event — renderer
   reads state; events are for sounds and one-shot animations
   (TreeFelled, BuildingCompleted, WareProduced...).

## P2 scope (first playable economy)

- Start: HQ placed at map HQ position with starting inventory (use original values
  from docs/gameplay-notes/CONSTANTS.md once extracted; placeholder counts until then).
- Player actions: place flag, build road (node path picker), place building
  (woodcutter/forester/sawmill/quarry), demolish.
- Buildability: original rules approximated — flag spacing >= 2 edges, buildings need
  a free flag spot SE of the door node, terrain must be buildable (meadow family);
  exact building-quality map (hut/house/castle/mine) comes with CONSTANTS.md.
- Settler jobs P2: carrier, builder, woodcutter, forester, sawmill worker, stonemason.
  New settlers materialize at HQ (recruitment chains are P3).
- Economy loop: trees felled -> trunk -> sawmill -> planks; quarry -> stones; planks +
  stones -> construction sites. Win state: none (sandbox).

## Public API (packages/engine/src/index.ts)

```
createWorld(mapJson, options: { seed, players }) -> World
applyCommand(world, command)            // validates + queues
tickWorld(world) -> Event[]             // one GF
serializeWorld(world) -> Uint8Array/JSON; deserializeWorld(...)
hashWorld(world) -> string
view helpers: flagsAt, roadsThrough, buildableAt, settlersOnScreen(rect) etc.
```

Renderer/app consume ONLY this API plus read-only state views. The renderer stays
engine-agnostic: the app maps engine state -> render scene (sprite lists) each frame.
