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
* ``hd2/`` the same three files for a 2x MMPX-magnified copy (see :mod:`s2gold.upscale`),
  written for the archives the game world draws (:data:`HD_ARCHIVES`). Its ``atlas.json``
  carries ``"scale": 2``: coordinates, sizes and anchors are in magnified atlas pixels.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import numpy as np
from PIL import Image

from s2gold.atlas import DEFAULT_PADDING, AtlasPacker, Placement, SpriteInput
from s2gold.core import Manifest, write_json
from s2gold.formats import lst
from s2gold.formats.bitmaps import DecodedSprite, decode_bitmap
from s2gold.formats.palette import Palette
from s2gold.upscale import SCALE, upscale_sprite

STANDARD_PALETTE = "PAL5.BBM"

# Archives the game world renders, which get a 2x set: the eight nation building sets
# (summer and winter), ships, settler work animations, and the three landscape object
# archives. Menus and UI icons stay 1x.
HD_ARCHIVES = frozenset(
    {
        "rom_z", "wrom_z", "vik_z", "wvik_z", "afr_z", "wafr_z", "jap_z", "wjap_z",
        "boot_z", "cbob_rom_bobs", "mapbobs", "mapbobs0", "mapbobs1",
    }
)  # fmt: skip
HD_DIR = f"hd{SCALE}"
HD_PADDING = 2

SpriteEntries = Callable[[list[tuple[int, DecodedSprite]], dict[int, Placement], bool], dict[str, object]]


def _archive_paths(extracted: Path) -> list[tuple[Path, str]]:
    """Collect every graphics LST archive with its output archive name, in a stable order.

    Most archives take their bare lowercased stem. The ``DATA/CBOB`` directory ships a
    *second* ``ROM_BOBS.LST`` — the settler *work* animations (chopping, sawing, fishing,
    sowing, planting, ...), distinct from the ``DATA/MBOB`` ``ROM_BOBS.LST`` building
    graphics — so it is namespaced ``cbob_rom_bobs`` to avoid colliding with the MBOB
    archive that keeps the bare ``rom_bobs`` name.
    """
    data = extracted / "DATA"
    entries: list[tuple[Path, str]] = [(p, p.stem.lower()) for p in sorted(data.glob("*.LST"))]
    entries += [(p, p.stem.lower()) for p in sorted((data / "MBOB").glob("*.LST"))]
    cbob = data / "CBOB" / "ROM_BOBS.LST"
    if cbob.exists():
        entries.append((cbob, "cbob_rom_bobs"))
    boat = data / "BOBS" / "BOAT.LST"
    if boat.exists():
        entries.append((boat, boat.stem.lower()))
    return entries


def run(extracted: Path, assets: Path, *, hd: bool = True) -> None:
    """Convert every graphics archive to atlases and register them in the manifest.

    Args:
        extracted: innoextract output root (contains ``DATA`` and ``GFX``).
        assets: Web asset output root.
        hd: Also write the 2x sets for :data:`HD_ARCHIVES`.
    """
    standard = Palette.from_bbm(extracted / "GFX" / "PALETTE" / STANDARD_PALETTE)
    index: dict[str, object] = {}
    hd_index: dict[str, object] = {}
    for path, name in _archive_paths(extracted):
        with_hd = hd and name in HD_ARCHIVES
        info = _convert_archive(path, standard, assets / "graphics" / name, hd=with_hd)
        index[name] = f"graphics/{name}/atlas.json"
        if with_hd:
            hd_index[name] = f"graphics/{name}/{HD_DIR}/atlas.json"
        print(
            f"[graphics] {name}: {info['sprite_count']} sprites, "
            f"{info['atlas_count']} atlas(es), skipped {info['skipped']}" + (" +hd" if with_hd else "")
        )
    manifest = Manifest()
    manifest.add("graphics", index)
    if hd:
        manifest.add("graphics_hd", {"scale": SCALE, "archives": hd_index})
    manifest.save(assets)


def pack_sprites(
    decoded: list[tuple[int, DecodedSprite]], out_dir: Path, padding: int = DEFAULT_PADDING
) -> tuple[dict[int, Placement], int, bool]:
    """Pack decoded sprites into ``atlas_N.png`` pages plus parallel player masks.

    Returns:
        The placement of every sprite by key, the page count, and whether masks were written.
    """
    packer = AtlasPacker(padding=padding)
    for key, sprite in decoded:
        packer.add(SpriteInput(key, sprite.width, sprite.height, sprite.rgba))
    placements = packer.save(out_dir, prefix="atlas")
    by_key = {p.key: p for p in placements}
    has_masks = _write_pmasks(decoded, by_key, out_dir)
    return by_key, packer.atlas_count, has_masks


def write_hd_set(
    payload: dict[str, object],
    decoded: list[tuple[int, DecodedSprite]],
    out_dir: Path,
    entries: SpriteEntries,
) -> None:
    """Write the 2x MMPX set of an archive into ``<out_dir>/hd2``.

    The payload is the archive's 1x ``atlas.json``; the copy keeps every other field
    (composition tables, counts) and replaces the page lists and sprite entries.
    """
    hd_dir = out_dir / HD_DIR
    if hd_dir.exists():
        for old in hd_dir.glob("*.png"):
            old.unlink()
    big = [(key, upscale_sprite(sprite)) for key, sprite in decoded]
    by_key, count, has_masks = pack_sprites(big, hd_dir, padding=HD_PADDING)
    hd_payload = dict(payload)
    hd_payload.update(
        {
            "scale": SCALE,
            "atlas_count": count,
            "atlases": [f"atlas_{i}.png" for i in range(count)],
            "pmasks": [f"pmask_{i}.png" for i in range(count)] if has_masks else [],
            "sprites": entries(big, by_key, has_masks),
        }
    )
    write_json(hd_dir / "atlas.json", hd_payload)


def decode_archive(path: Path, standard: Palette) -> tuple[list[tuple[int, DecodedSprite]], dict[str, int]]:
    """Decode every bitmap of a graphics archive, with counts of the skipped item kinds.

    An embedded palette item applies to the bitmaps that follow it.
    """
    items = lst.read_lst(path.read_bytes())
    palette = standard
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
            decoded.append((item.index, decode_bitmap(item, palette)))
    return decoded, skipped


def archive_path(extracted: Path, name: str) -> Path | None:
    """Source LST of an output archive name (e.g. ``rom_z``), or None."""
    return next((path for path, n in _archive_paths(extracted) if n == name), None)


def _convert_archive(path: Path, standard: Palette, out_dir: Path, *, hd: bool = False) -> dict[str, object]:
    """Decode, pack and serialise a single archive; return a small summary dict."""
    decoded, skipped = decode_archive(path, standard)

    by_key, atlas_count, has_masks = pack_sprites(decoded, out_dir)
    sprites = _sprite_entries(decoded, by_key, has_masks)

    payload: dict[str, object] = {
        "archive": out_dir.name,
        "atlas_count": atlas_count,
        "atlases": [f"atlas_{i}.png" for i in range(atlas_count)],
        "pmasks": [f"pmask_{i}.png" for i in range(atlas_count)] if has_masks else [],
        "mask_encoding": "R = player-color shade (1-4 as shade+1), A = 255 where player-colored",
        "skipped": skipped,
        "sprites": sprites,
    }
    write_json(out_dir / "atlas.json", payload)
    if hd:
        write_hd_set(payload, decoded, out_dir, _sprite_entries)
    return {"sprite_count": len(sprites), "atlas_count": atlas_count, "skipped": skipped}


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
    shade = np.frombuffer(sprite.player_mask, dtype=np.uint8).reshape(sprite.height, sprite.width)
    out = np.zeros((sprite.height, sprite.width, 4), dtype=np.uint8)
    out[..., 0] = shade
    out[..., 3] = np.where(shade != 0, 255, 0)
    return Image.frombytes("RGBA", (sprite.width, sprite.height), out.tobytes())
