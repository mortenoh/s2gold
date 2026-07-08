# Pipeline contracts (read me first)

Rules for every implementation agent working on this repo.

## Ground rules

- **Clean room**: implement from the prose specs (settlers2.net, see LINKS.md) and from
  facts (offsets, magic numbers, constants). Do NOT copy or transliterate code from
  RttR/libsiedler2 (GPL) — consult it only to resolve ambiguities, then write your own
  independent implementation.
- **Never commit**: no git commands. The orchestrator reviews and commits.
- **Stay in your assigned paths.** Shared modules (`binio.py`, `iff.py`, `palette.py`,
  `core.py`, `cli.py`, `convert/__init__.py`) are owned by the orchestrator — read
  them, don't edit them. If a contract change is needed, note it in your final report.
- Real game data for tests lives at `<repo>/extracted/` (DATA/, GFX/). It exists on
  this machine. Tests that need it use `pytest.mark.assets` + skipif on the path.
- Style: ruff/mypy/pyright configured in pyproject.toml (line length 120, google
  docstrings, strict typing). Run `uv run ruff format`, `uv run ruff check --fix`,
  `uv run mypy src`, `uv run pytest` before finishing. All must pass.

## Converter module contract

Each module in `src/s2gold/convert/` exposes:

```python
def run(extracted: Path, assets: Path) -> None: ...
```

- `extracted` = innoextract output root (contains `DATA/`, `GFX/`).
- `assets` = web asset output root (`packages/app/public/assets/`).
- Must be idempotent (safe to re-run; overwrite outputs).
- Register what you produced in the manifest:
  `m = Manifest(); m.add("<category>", {...index...}); m.save(assets)`
  (`s2gold.core.Manifest` merges with the manifest on disk.)

## Output layout under `packages/app/public/assets/`

```
manifest.json
palettes/pal5.json ...            256×[r,g,b] arrays
terrain/tex5.png ...              tilesets, plus terrain/gouraud5.json shading LUTs
graphics/<archive>/atlas_N.png    sprite atlases (RGBA, transparent bg)
graphics/<archive>/atlas.json     per-sprite: x,y,w,h in atlas + nx,ny anchor + kind
fonts/<name>.png + <name>.json    glyph atlas + metrics
maps/<name>.json                  parsed map (see maps agent brief)
texts/<lang>/<name>.json          string arrays keyed by original file
sfx/<id>.wav + sfx/index.json
music/<track>.ogg + music/index.json
video/intro.webm                  (optional)
```

Naming: lowercase, original basenames (`mapbobs`, `rom_y`, `tex5`, ...).

## Player-color sprites

Bitmap type 4 ("player" bitmaps) contain pixels that get recolored per player. Emit the
base sprite with those pixels in the *first* player's colors AND a separate grayscale/
mask PNG (`*_pmask.png`) marking player-color pixels + shade index, so the renderer can
tint at runtime. Record the palette indices used in atlas.json.

## Verified local facts (from this machine's real data)

- LST container: little-endian; u16 magic 0x4E20, u32 item count; per item s16 used
  (parse item only when == 1), then s16 bobtype, then type-specific payload with no
  stored length (you must fully parse each item to advance).
- Bobtypes seen: 1=sound (u32 length + payload — raw PCM or XMIDI), 5=palette
  (u16 count=256 + 768 RGB bytes). Bitmap types (2 RLE, 4 player, 6 BOB, 7 shadow,
  14 raw) per settlers2.net LST doc.
- `GFX/TEXTURES/TEX5.LBM`: IFF `FORM`/`PBM `, BMHD (big-endian: w,h u16; compression
  byte flag 1 = PackBits), CMAP, BODY. 256×256, 8bpp chunky. Decodes correctly.
- `GFX/PALETTE/PAL5.BBM`: IFF with 768-byte CMAP. (LST-embedded palettes exist too.)
- `DATA/SOUNDDAT/SOUND.LST`: 200 items — 199 sounds are raw **unsigned 8-bit PCM,
  no header**, play at 11025 Hz mono; item 0 is XMIDI. Wrapping with a 44-byte WAV
  header at 11025 Hz produces correct audio (verified with ffprobe).
- `DATA/SOUNDDAT/SNG/SNG_*.DAT`: bare XMIDI: `FORM????XDIR` + `CAT ????XMID` with
  TIMB/EVNT chunks. 25 tracks.
- Maps `DATA/MAPS*/*.WLD`, `WORLDS/*.SWD`: header starts with magic `WORLD_V1.0`
  then 20-byte NUL-padded title (verified: "I - Off we go").
- Texts `DATA/TXT*/*.{ENG,GER}` and `DATA/MISSIONS/*.RTX`: magic u16 0xFDE7 (bytes
  E7 FD), then u16 count, u16 unused, u32 size, then u32 offsets… per settlers2.net;
  encoding cp437-ish (verify umlauts against GER files).
- Gouraud tables `DATA/TEXTURES/GOU*.DAT`: raw 256×256 byte LUTs
  (palette index × light level → palette index); see settlers2.net lighting article.
- Shared helpers already implemented: `s2gold.formats.binio.Reader`,
  `s2gold.formats.iff.read_form/unpack_bits`, `s2gold.formats.palette.Palette`
  (from_bbm / from_lst_item), `s2gold.core` (paths, Manifest, tool helpers).
