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

- Feasibility study: `docs/FEASIBILITY.md`
- Implementation plan: `docs/PLAN.md`
- Open work (features, bugs, polish): `docs/ROADMAP.md`
- Asset pipeline: Python 3.13 (`uv`, typer) under `src/s2gold/`
- Game: TypeScript + WebGL2 under `packages/`

Requirements: `uv`, `pnpm`, `innoextract` (required), `fluidsynth` + `ffmpeg`
(optional, for music/intro video conversion).
