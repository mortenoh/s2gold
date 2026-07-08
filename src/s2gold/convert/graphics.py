"""Converter: graphics LST archives to PNG sprite atlases plus per-archive JSON.

For every graphics archive the converter decodes each bitmap item with the appropriate
palette (the standard PAL5, unless the archive embeds its own palette item, which then
applies to the bitmaps that follow it), packs the sprites into RGBA atlases, and writes a
sidecar ``atlas.json`` describing every sprite. Player-color sprites additionally get a
parallel ``pmask_N.png`` (same coordinates as the colour atlas) encoding the player-color
shade so the renderer can tint per player at runtime.

Output layout under ``<assets>/graphics/<archive>/``:

* ``atlas_N.png`` colour atlases (RGBA, transparent background).
* ``pmask_N.png`` player-color shade masks (only when the archive has player sprites).
* ``atlas.json`` the sprite index and skipped-item counts.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from s2gold.atlas import AtlasPacker, Placement, SpriteInput
from s2gold.core import Manifest, write_json
from s2gold.formats import lst
from s2gold.formats.bitmaps import DecodedSprite, decode_bitmap
from s2gold.formats.palette import Palette

STANDARD_PALETTE = "PAL5.BBM"


def _archive_paths(extracted: Path) -> list[Path]:
    """Collect every graphics LST archive in a stable order."""
    data = extracted / "DATA"
    paths = sorted((data).glob("*.LST"))
    paths += sorted((data / "MBOB").glob("*.LST"))
    boat = data / "BOBS" / "BOAT.LST"
    if boat.exists():
        paths.append(boat)
    return paths


def run(extracted: Path, assets: Path) -> None:
    """Convert every graphics archive to atlases and register them in the manifest.

    Args:
        extracted: innoextract output root (contains ``DATA`` and ``GFX``).
        assets: Web asset output root.
    """
    standard = Palette.from_bbm(extracted / "GFX" / "PALETTE" / STANDARD_PALETTE)
    index: dict[str, object] = {}
    for path in _archive_paths(extracted):
        name = path.stem.lower()
        info = _convert_archive(path, standard, assets / "graphics" / name)
        index[name] = f"graphics/{name}/atlas.json"
        print(
            f"[graphics] {name}: {info['sprite_count']} sprites, "
            f"{info['atlas_count']} atlas(es), skipped {info['skipped']}"
        )
    manifest = Manifest()
    manifest.add("graphics", index)
    manifest.save(assets)


def _convert_archive(path: Path, standard: Palette, out_dir: Path) -> dict[str, object]:
    """Decode, pack and serialise a single archive; return a small summary dict."""
    items = lst.read_lst(path.read_bytes())
    palette = standard
    packer = AtlasPacker()
    decoded: list[tuple[int, DecodedSprite]] = []
    skipped = {"sound": 0, "palette": 0, "font": 0, "bob": 0}
    for item in items:
        if isinstance(item, lst.PaletteItem):
            palette = item.palette
            skipped["palette"] += 1
        elif isinstance(item, lst.SoundItem):
            skipped["sound"] += 1
        elif isinstance(item, lst.FontItem):
            skipped["font"] += 1
        elif isinstance(item, lst.BobItem):
            skipped["bob"] += 1
        else:
            sprite = decode_bitmap(item, palette)
            decoded.append((item.index, sprite))
            packer.add(SpriteInput(item.index, sprite.width, sprite.height, sprite.rgba))

    placements = packer.save(out_dir, prefix="atlas")
    by_key = {p.key: p for p in placements}
    has_masks = _write_pmasks(decoded, by_key, out_dir)
    sprites = _sprite_entries(decoded, by_key, has_masks)

    payload: dict[str, object] = {
        "archive": out_dir.name,
        "atlas_count": packer.atlas_count,
        "atlases": [f"atlas_{i}.png" for i in range(packer.atlas_count)],
        "pmasks": [f"pmask_{i}.png" for i in range(packer.atlas_count)] if has_masks else [],
        "mask_encoding": "R = player-color shade (1-4 as shade+1), A = 255 where player-colored",
        "skipped": skipped,
        "sprites": sprites,
    }
    write_json(out_dir / "atlas.json", payload)
    return {"sprite_count": len(sprites), "atlas_count": packer.atlas_count, "skipped": skipped}


def _sprite_entries(
    decoded: list[tuple[int, DecodedSprite]],
    by_key: dict[int, Placement],
    has_masks: bool,
) -> dict[str, object]:
    """Build the ``sprites`` map for atlas.json."""
    sprites: dict[str, object] = {}
    for index, sprite in decoded:
        placement = by_key[index]
        entry: dict[str, object] = {
            "atlas": placement.atlas,
            "x": placement.x,
            "y": placement.y,
            "w": placement.width,
            "h": placement.height,
            "nx": sprite.nx,
            "ny": sprite.ny,
            "kind": sprite.kind,
        }
        if has_masks and sprite.player_mask is not None:
            entry["pmask"] = True
            entry["player_indices"] = list(sprite.player_indices)
        sprites[str(index)] = entry
    return sprites


def _write_pmasks(
    decoded: list[tuple[int, DecodedSprite]],
    by_key: dict[int, Placement],
    out_dir: Path,
) -> bool:
    """Write player-color shade masks parallel to the colour atlases.

    Returns:
        True when at least one player mask was written.
    """
    masked = [(i, s) for i, s in decoded if s.player_mask is not None]
    if not masked:
        return False
    extents: dict[int, tuple[int, int]] = {}
    for index, _ in masked:
        p = by_key[index]
        w, h = extents.get(p.atlas, (0, 0))
        extents[p.atlas] = (max(w, p.x + p.width), max(h, p.y + p.height))
    images = {a: Image.new("RGBA", (max(1, w), max(1, h)), (0, 0, 0, 0)) for a, (w, h) in extents.items()}
    for index, sprite in masked:
        p = by_key[index]
        assert sprite.player_mask is not None
        tile = _mask_image(sprite)
        images[p.atlas].paste(tile, (p.x, p.y))
    for atlas_index, image in images.items():
        image.save(out_dir / f"pmask_{atlas_index}.png")
    return True


def _mask_image(sprite: DecodedSprite) -> Image.Image:
    """Render a player-color shade mask as an RGBA tile (R = shade+1, A = 255)."""
    assert sprite.player_mask is not None
    out = bytearray(sprite.width * sprite.height * 4)
    for i, shade in enumerate(sprite.player_mask):
        if shade:
            o = i * 4
            out[o] = shade
            out[o + 3] = 255
    return Image.frombytes("RGBA", (sprite.width, sprite.height), bytes(out))
