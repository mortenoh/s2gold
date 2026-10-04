# s2gold

A clean-room, browser-based reimplementation of The Settlers II Gold Edition.

This repository contains **no game assets**. You need your own copy of the game from
GOG. Run:

```sh
make install INSTALLER="path/to/setup_the_settlers_2_gold_*.exe"
```

This extracts the installer locally (innoextract) and converts all graphics, sounds,
music, maps and texts into web-native assets under `packages/app/public/assets/`
(git-ignored). Then `make dev` serves the game at http://127.0.0.1:5199 and starts the Rust
save API. Ctrl-C stops both processes. Saves use `s2gold.db` by default;
`S2GOLD_DB_PATH` selects a separate database and `S2GOLD_PORT` changes the API port.
For frontend-only development, use `pnpm --filter app dev` with an existing API.

- How to play: `docs/GUIDE.md` (new-player guide; screenshots via `pnpm guide:shots`)
- Feasibility study: `docs/FEASIBILITY.md`
- Implementation plan: `docs/PLAN.md`
- Open work (features, bugs, polish): `ROADMAP.md`
- Asset pipeline: Python 3.13 (`uv`, typer) under `src/s2gold/`
- Game: TypeScript + WebGL2 under `packages/`
- Server (app + assets + saves/sessions API): Rust (axum + turso) under `crates/server/`,
  run via `make serve`; saves live in a single database (`s2gold.db`), and any
  pre-database JSON files in `saves/`/`sessions/` are imported on first startup
- Desktop app: Tauri shell under `crates/desktop/` embedding the same server
  with the frontend compiled in and the converted assets bundled as a
  resource, so the built .app runs on its own; saves live under the OS
  app-data directory. Run via `make desktop`, bundle via `make desktop-app`
  (after `make install`; the bundle contains original art, keep it local)

Requirements: `uv`, `pnpm`, `cargo`, `innoextract` (required), `fluidsynth` + `ffmpeg`
(optional, for music/intro video conversion).

Gameplay verification:

- `node --test scripts/dev.test.mjs` checks development startup and shutdown.
- `pnpm e2e` starts its own frontend/API with a temporary save database (ports
  5299/8299; override with `S2GOLD_E2E_PORT` / `S2GOLD_E2E_API_PORT`).
- `bun run packages/engine/scripts/verify-maps.ts` checks every converted map
  with AI play and save/replay continuity.

Wildlife conversion now retains the original animal footer records. Existing
converted maps still work from their animal layer; run the asset conversion again
to preserve multiple animals at the same node. Version 7 and older saves load
with no animals, since they never stored wildlife; new games use the map population.
