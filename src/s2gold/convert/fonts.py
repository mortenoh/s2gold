"""Converter: bitmap fonts to a per-font glyph atlas PNG plus a metrics JSON.

The game's fonts live as font items (bob-type 3) inside ``RESOURCE.DAT`` (``font09``,
``font11``, ``font14``), plus the standalone ``DATA/IO/FONT14.FNT`` which is a bare font
item. Each glyph is a player-color bitmap: its "ink" pixels are player-colored so the
engine can draw text in any colour. This converter renders every glyph's ink as opaque
white on a transparent background (preserving the glyph shape) so the app can tint it at
runtime, packs a font's glyphs into one ``fonts/<name>.png`` image, and writes
``fonts/<name>.json`` with the font's ``dx``/``dy`` spacing and per-glyph placement and
anchor metrics keyed by character code.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from s2gold.convert.graphics import STANDARD_PALETTE
from s2gold.core import Manifest, write_json
from s2gold.formats import datidx, lst
from s2gold.formats.binio import Reader
from s2gold.formats.bitmaps import decode_bitmap
from s2gold.formats.palette import Palette

_MAX_ROW_WIDTH = 512
_PADDING = 1


@dataclass(frozen=True)
class _Glyph:
    """A rendered glyph ready to pack."""

    char: int
    width: int
    height: int
    nx: int
    ny: int
    rgba: bytes


def run(extracted: Path, assets: Path) -> None:
    """Convert every font to a glyph atlas + metrics JSON and register the ``fonts`` category.

    Args:
        extracted: innoextract output root (contains ``DATA`` and ``GFX``).
        assets: Web asset output root.
    """
    palette = Palette.from_bbm(extracted / "GFX" / "PALETTE" / STANDARD_PALETTE)
    out_dir = assets / "fonts"
    index: dict[str, object] = {}
    for name, font in _collect_fonts(extracted):
        info = _convert_font(name, font, palette, out_dir)
        index[name] = f"fonts/{name}.json"
        print(f"[fonts] {name}: {info} glyphs, dx={font.dx} dy={font.dy}")
    manifest = Manifest()
    manifest.add("fonts", index)
    manifest.save(assets)


def _collect_fonts(extracted: Path) -> list[tuple[str, lst.FontItem]]:
    """Gather every font as ``(name, FontItem)`` from RESOURCE.DAT and FONT14.FNT."""
    data = extracted / "DATA"
    fonts: list[tuple[str, lst.FontItem]] = []
    resource_idx, resource_dat = data / "RESOURCE.IDX", data / "RESOURCE.DAT"
    if resource_idx.exists() and resource_dat.exists():
        archive = datidx.read_archive(resource_idx, resource_dat)
        for entry, item in zip(archive.entries, archive.items, strict=True):
            if isinstance(item, lst.FontItem):
                fonts.append((entry.name, item))
    font14 = data / "IO" / "FONT14.FNT"
    if font14.exists():
        item = lst.read_item_at(Reader(font14.read_bytes()), 0)
        if isinstance(item, lst.FontItem):
            fonts.append(("font14_fnt", item))
    return fonts


def _convert_font(name: str, font: lst.FontItem, palette: Palette, out_dir: Path) -> int:
    """Render, pack and serialise a single font; return the glyph count."""
    glyphs = [_render_glyph(g, palette) for g in font.glyphs]
    image, placements = _pack(glyphs)
    out_dir.mkdir(parents=True, exist_ok=True)
    image.save(out_dir / f"{name}.png")
    payload: dict[str, object] = {
        "name": name,
        "dx": font.dx,
        "dy": font.dy,
        "image": f"{name}.png",
        "width": image.width,
        "height": image.height,
        "glyphs": placements,
    }
    write_json(out_dir / f"{name}.json", payload)
    return len(glyphs)


def _render_glyph(item: lst.BitmapItem, palette: Palette) -> _Glyph:
    """Decode a glyph bitmap and recolour its ink to opaque white (shape-preserving)."""
    sprite = decode_bitmap(item, palette)
    out = bytearray(sprite.rgba)
    for i in range(0, len(out), 4):
        if out[i + 3]:
            out[i] = out[i + 1] = out[i + 2] = 255
    return _Glyph(item.index, sprite.width, sprite.height, sprite.nx, sprite.ny, bytes(out))


def _pack(glyphs: list[_Glyph]) -> tuple[Image.Image, dict[str, object]]:
    """Shelf-pack glyphs into one image; return the image and per-char placement metrics."""
    x = y = row_h = used_w = 0
    positions: dict[int, tuple[int, int]] = {}
    for g in glyphs:
        if x > 0 and x + g.width > _MAX_ROW_WIDTH:
            x, y, row_h = 0, y + row_h + _PADDING, 0
        positions[g.char] = (x, y)
        x += g.width + _PADDING
        row_h = max(row_h, g.height)
        used_w = max(used_w, x)
    total_h = y + row_h
    image = Image.new("RGBA", (max(1, used_w), max(1, total_h)), (0, 0, 0, 0))
    metrics: dict[str, object] = {}
    for g in glyphs:
        px, py = positions[g.char]
        if g.width and g.height and g.rgba:
            image.paste(Image.frombytes("RGBA", (g.width, g.height), g.rgba), (px, py))
        metrics[str(g.char)] = {"x": px, "y": py, "w": g.width, "h": g.height, "nx": g.nx, "ny": g.ny}
    return image, metrics
