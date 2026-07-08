"""Convert terrain tilesets and gouraud shading tables into web assets.

Produces, under ``<assets>/terrain/``:

* ``<name>.png`` -- the tileset rendered to RGBA through its palette.
* ``<name>_indexed.png`` -- a grayscale image of the raw palette indices, kept so
  the renderer can re-apply palette-correct lighting via the gouraud tables.
* ``gouraud{5,6,7}.json`` -- the 256x256 shading lookup tables (base64 payload).

Palette pairing (per the settlers2.net lighting article and verified on disk):
``TEX5/TEX6/TEX7.LBM`` render through ``PAL5/PAL6/PAL7.BBM`` respectively. The
legacy ``TEXTUR_0.LBM`` (greenland) and ``TEXTUR_3.LBM`` (winter) files carry
their own embedded ``CMAP`` and render through that.
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

from s2gold.core import Manifest
from s2gold.formats.gouraud import load_gouraud
from s2gold.formats.lbm import decode_lbm
from s2gold.formats.palette import Palette

# (tileset filename, output name, external palette filename or None for embedded CMAP).
_TILESETS: tuple[tuple[str, str, str | None], ...] = (
    ("TEX5.LBM", "tex5", "PAL5.BBM"),
    ("TEX6.LBM", "tex6", "PAL6.BBM"),
    ("TEX7.LBM", "tex7", "PAL7.BBM"),
    ("TEXTUR_0.LBM", "textur_0", None),
    ("TEXTUR_3.LBM", "textur_3", None),
)

_GOURAUD: tuple[tuple[str, str], ...] = (
    ("GOU5.DAT", "gouraud5"),
    ("GOU6.DAT", "gouraud6"),
    ("GOU7.DAT", "gouraud7"),
)


def _render_rgba(width: int, height: int, pixels: bytes, palette: Palette) -> Image.Image:
    """Build an RGBA image from palette indices and a palette."""
    colors = palette.colors
    rgba = bytearray(width * height * 4)
    for i, idx in enumerate(pixels):
        r, g, b = colors[idx]
        o = i * 4
        rgba[o] = r
        rgba[o + 1] = g
        rgba[o + 2] = b
        rgba[o + 3] = 255
    return Image.frombytes("RGBA", (width, height), bytes(rgba))


def run(extracted: Path, assets: Path) -> None:
    """Convert terrain tilesets and gouraud tables (see module docstring)."""
    tex_dir = extracted / "GFX" / "TEXTURES"
    pal_dir = extracted / "GFX" / "PALETTE"
    gou_dir = extracted / "DATA" / "TEXTURES"
    out_dir = assets / "terrain"
    out_dir.mkdir(parents=True, exist_ok=True)

    textures: dict[str, object] = {}
    for src, name, pal_name in _TILESETS:
        src_path = tex_dir / src
        if not src_path.exists():
            continue
        img = decode_lbm(src_path.read_bytes())
        if pal_name is not None:
            palette = Palette.from_bbm(pal_dir / pal_name)
        elif img.palette is not None:
            palette = img.palette
        else:
            raise ValueError(f"{src}: no palette available (no external PAL and no embedded CMAP)")

        _render_rgba(img.width, img.height, img.pixels, palette).save(out_dir / f"{name}.png")
        Image.frombytes("L", (img.width, img.height), img.pixels).save(out_dir / f"{name}_indexed.png")
        textures[name] = {
            "png": f"terrain/{name}.png",
            "indexed": f"terrain/{name}_indexed.png",
            "width": img.width,
            "height": img.height,
            "palette": pal_name.removesuffix(".BBM").lower() if pal_name else "embedded",
        }

    gouraud: dict[str, object] = {}
    for src, name in _GOURAUD:
        src_path = gou_dir / src
        if not src_path.exists():
            continue
        table = load_gouraud(src_path)
        (out_dir / f"{name}.json").write_text(json.dumps(table.to_json_dict(), separators=(",", ":")))
        gouraud[name] = f"terrain/{name}.json"

    manifest = Manifest()
    manifest.add("terrain", {"textures": textures, "gouraud": gouraud})
    manifest.save(assets)
