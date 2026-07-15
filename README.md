# s2gold

A clean-room, browser-based reimplementation of The Settlers II Gold Edition.

This repository contains **no game assets**. You need your own copy of the game from
GOG. Run:

```sh
make install INSTALLER="path/to/setup_the_settlers_2_gold_*.exe"
```

This extracts the installer locally (innoextract) and converts all graphics, sounds,
music, maps and texts into web-native assets under `packages/app/public/assets/`
(git-ignored). Then `make dev` serves the game.

- How to play: `docs/GUIDE.md` (new-player guide; screenshots via `pnpm guide:shots`)
- Feasibility study: `docs/FEASIBILITY.md`
- Implementation plan: `docs/PLAN.md`
- Open work (features, bugs, polish): `ROADMAP.md`
- Asset pipeline: Python 3.13 (`uv`, typer) under `src/s2gold/`
- Game: TypeScript + WebGL2 under `packages/`
- Server (app + assets + saves/sessions API): Rust (axum + turso) under `crates/server/`,
  run via `make serve`; saves live in a single database (`s2gold.db`), and any
  pre-database JSON files in `saves/`/`sessions/` are imported on first startup
- Desktop app: Tauri shell under `crates/desktop/` embedding the same server,
  run via `make desktop`

Requirements: `uv`, `pnpm`, `cargo`, `innoextract` (required), `fluidsynth` + `ffmpeg`
(optional, for music/intro video conversion).
