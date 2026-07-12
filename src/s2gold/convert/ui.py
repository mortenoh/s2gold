"""Converter: IDX/DAT resource archives to PNG sprite atlases plus per-archive JSON.

The game's UI graphics live in IDX/DAT pairs rather than LST containers: ``RESOURCE`` and
``IO`` (plus the map editor's ``EDITRES`` / ``EDITIO``). This converter decodes their
bitmap items with the same pipeline as :mod:`s2gold.convert.graphics` and emits the same
``graphics/<archive>/`` atlas layout, so the app treats UI sprites exactly like other
sprites. Font and palette items in these archives are handled elsewhere (see
:mod:`s2gold.convert.fonts`) and skipped here.

Each sprite entry additionally carries its ``name`` from the IDX directory, since UI
sprites are addressed by name (e.g. ``back_00``) rather than by numeric slot.

Output lands under ``<assets>/graphics/<archive>/`` and is registered by *extending* the
existing ``graphics`` manifest category rather than replacing it.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from s2gold.atlas import AtlasPacker, Placement, SpriteInput
from s2gold.convert.graphics import STANDARD_PALETTE, _write_pmasks
from s2gold.core import Manifest, write_json
from s2gold.formats import datidx, lst
from s2gold.formats.bitmaps import BitmapItem, DecodedSprite, decode_bitmap
from s2gold.formats.palette import Palette


@dataclass(frozen=True)
class _Archive:
    """One IDX/DAT archive to convert."""

    name: str
    idx: Path
    dat: Path


# Standalone UI chrome emitted as individual PNGs (plus the atlases above), so
# the web UI can position them with CSS. From RESOURCE.DAT, decoded through its
# embedded roemerpal palette.
_FRAME_PIECES = ("dskbobol", "dskbobor", "dskbobul", "dskbobur", "dskov10l", "dskov10r", "dskbobic")
_CURSOR_PIECES = ("handa", "handb", "handc", "handw", "handk", "handl")
_WINDOW_PIECES = (
    "leftfram",
    "rghtfram",
    "bottfram",
    "leftbord",
    "rghtbord",
    "patter01",
    "titlepas",
    "titleact",
    "titleslc",
    "closicup",
    "closicdn",
    "zoomicup",
    "iconicup",
    "dmmyicup",
)


def _emit_resource_ui(extracted: Path, assets: Path) -> None:
    """Decode the RESOURCE.DAT frame + cursor bitmaps to individual ui/ PNGs."""
    arc = datidx.read_archive(extracted / "DATA" / "RESOURCE.IDX", extracted / "DATA" / "RESOURCE.DAT")
    palette = next(
        (
            it.palette
            for e, it in zip(arc.entries, arc.items, strict=True)
            if isinstance(it, lst.PaletteItem) and e.name == "roemerpal"
        ),
        None,
    )
    if palette is None:
        return
    by_name = {e.name: it for e, it in zip(arc.entries, arc.items, strict=True)}
    out_dir = assets / "ui"
    out_dir.mkdir(parents=True, exist_ok=True)
    pieces: dict[str, object] = {}
    for name in _FRAME_PIECES + _CURSOR_PIECES + _WINDOW_PIECES:
        item = by_name.get(name)
        if not isinstance(item, BitmapItem):
            continue
        sprite = decode_bitmap(item, palette)
        Image.frombytes("RGBA", (sprite.width, sprite.height), bytes(sprite.rgba)).save(out_dir / f"{name}.png")
        pieces[name] = {"png": f"ui/{name}.png", "width": sprite.width, "height": sprite.height}
    write_json(
        out_dir / "index.json",
        {
            "pieces": pieces,
            "frame": list(_FRAME_PIECES),
            "cursor": list(_CURSOR_PIECES),
            "window": list(_WINDOW_PIECES),
        },
    )


def _archives(extracted: Path) -> list[_Archive]:
    """Collect the IDX/DAT archives that exist under ``extracted``, in a stable order."""
    data = extracted / "DATA"
    candidates = [
        _Archive("resource", data / "RESOURCE.IDX", data / "RESOURCE.DAT"),
        _Archive("io_dat", data / "IO" / "IO.IDX", data / "IO" / "IO.DAT"),
        _Archive("editio", data / "IO" / "EDITIO.IDX", data / "IO" / "EDITIO.DAT"),
        _Archive("editres", data / "EDITRES.IDX", data / "EDITRES.DAT"),
    ]
    return [a for a in candidates if a.idx.exists() and a.dat.exists()]


def run(extracted: Path, assets: Path) -> None:
    """Convert every IDX/DAT UI archive to atlases and extend the graphics manifest.

    Args:
        extracted: innoextract output root (contains ``DATA`` and ``GFX``).
        assets: Web asset output root.
    """
    standard = Palette.from_bbm(extracted / "GFX" / "PALETTE" / STANDARD_PALETTE)
    index = _existing_graphics(assets)
    for archive in _archives(extracted):
        info = _convert_archive(archive, standard, assets / "graphics" / archive.name)
        index[archive.name] = f"graphics/{archive.name}/atlas.json"
        print(
            f"[ui] {archive.name}: {info['sprite_count']} sprites, "
            f"{info['atlas_count']} atlas(es), skipped {info['skipped']}"
        )
    if (extracted / "DATA" / "RESOURCE.DAT").exists():
        _emit_resource_ui(extracted, assets)
    manifest = Manifest()
    manifest.add("graphics", index)
    manifest.save(assets)


def _existing_graphics(assets: Path) -> dict[str, object]:
    """Read the current ``graphics`` manifest category so we extend rather than clobber it."""
    path = assets / "manifest.json"
    if not path.exists():
        return {}
    category = json.loads(path.read_text()).get("categories", {}).get("graphics")
    return dict(category) if isinstance(category, dict) else {}


def _convert_archive(archive: _Archive, standard: Palette, out_dir: Path) -> dict[str, object]:
    """Decode, pack and serialise a single IDX/DAT archive; return a small summary dict."""
    parsed = datidx.read_archive(archive.idx, archive.dat)
    palette = standard
    packer = AtlasPacker()
    decoded: list[tuple[int, DecodedSprite]] = []
    names: dict[int, str] = {}
    skipped = {"sound": 0, "palette": 0, "font": 0, "bob": 0}
    for i, (entry, item) in enumerate(zip(parsed.entries, parsed.items, strict=True)):
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
            decoded.append((i, sprite))
            names[i] = entry.name
            packer.add(SpriteInput(i, sprite.width, sprite.height, sprite.rgba))

    placements = packer.save(out_dir, prefix="atlas")
    by_key = {p.key: p for p in placements}
    has_masks = _write_pmasks(decoded, by_key, out_dir)
    sprites = _sprite_entries(decoded, names, by_key, has_masks)

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
    names: dict[int, str],
    by_key: dict[int, Placement],
    has_masks: bool,
) -> dict[str, object]:
    """Build the ``sprites`` map for atlas.json, keyed by slot index with the IDX name."""
    sprites: dict[str, object] = {}
    for index, sprite in decoded:
        placement = by_key[index]
        entry: dict[str, object] = {
            "name": names[index],
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
