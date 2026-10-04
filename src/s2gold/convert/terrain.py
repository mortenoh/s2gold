"""Convert terrain tilesets and gouraud shading tables into web assets.

Produces, under ``<assets>/terrain/``:

* ``<name>.png`` -- the tileset rendered to RGBA through its palette.
* ``<name>_indexed.png`` -- a grayscale image of the raw palette indices, kept so
  the renderer can re-apply palette-correct lighting via the gouraud tables.
* ``<name>_indexed_hd2.png`` -- the same indices magnified 2x with MMPX (TEX5-7 only);
  every output index is a copy of an input index, so lighting and cycling still apply.
* ``gouraud{5,6,7}.json`` -- the 256x256 shading lookup tables (base64 payload).

Palette pairing (per the settlers2.net lighting article and verified on disk):
``TEX5/TEX6/TEX7.LBM`` render through ``PAL5/PAL6/PAL7.BBM`` respectively. The
legacy ``TEXTUR_0.LBM`` (greenland) and ``TEXTUR_3.LBM`` (winter) files carry
their own embedded ``CMAP`` and render through that.
"""

from __future__ import annotations

import base64
from pathlib import Path

import numpy as np
from PIL import Image

from s2gold.core import Manifest, write_json
from s2gold.formats.gouraud import load_gouraud
from s2gold.formats.lbm import decode_lbm
from s2gold.formats.palette import Palette, palette_cycles
from s2gold.upscale import SCALE, upscale_indexed

# (tileset filename, output name, external palette filename or None for embedded CMAP).
_TILESETS: tuple[tuple[str, str, str | None], ...] = (
    ("TEX5.LBM", "tex5", "PAL5.BBM"),
    ("TEX6.LBM", "tex6", "PAL6.BBM"),
    ("TEX7.LBM", "tex7", "PAL7.BBM"),
    ("TEXTUR_0.LBM", "textur_0", None),
    ("TEXTUR_3.LBM", "textur_3", None),
)

# Tilesets the game renders (greenland, wasteland, winter), which get a 2x index image.
HD_TILESETS = frozenset({"tex5", "tex6", "tex7"})

# Texture rectangles inside a tileset, as (x, y, w, h). They mirror the terrain and edge
# strip tables in packages/renderer/src/terrain-data.ts. Each is magnified on its own with
# clamped edges, so a texture never picks up pixels from its neighbour in the sheet.
TEXTURE_REGIONS: tuple[tuple[int, int, int, int], ...] = (
    (0, 0, 32, 31), (48, 0, 32, 31), (96, 0, 32, 31), (144, 0, 32, 31),
    (0, 48, 32, 31), (48, 48, 32, 31), (96, 48, 32, 31), (144, 48, 32, 31),
    (0, 96, 32, 31), (48, 96, 32, 31), (96, 96, 32, 31), (144, 96, 32, 31),
    (0, 144, 32, 31), (48, 144, 32, 31),
    (193, 49, 53, 54), (193, 105, 53, 54),
    (66, 222, 31, 33), (99, 222, 31, 33), (132, 222, 31, 33),
    (192, 176, 64, 16), (192, 192, 64, 16), (192, 208, 64, 16), (192, 224, 64, 16), (192, 240, 64, 16),
)  # fmt: skip

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


def run(extracted: Path, assets: Path, *, hd: bool = True) -> None:
    """Convert terrain tilesets and gouraud tables (see module docstring).

    With ``hd``, the tilesets the game draws (:data:`HD_TILESETS`) also get a 2x MMPX
    index image, ``<name>_indexed_hd2.png``.
    """
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
        hd_name = None
        if hd and name in HD_TILESETS:
            hd_name = f"{name}_indexed_hd{SCALE}.png"
            indices = np.frombuffer(img.pixels, dtype=np.uint8).reshape(img.height, img.width)
            big = upscale_indexed(indices, palette.colors, TEXTURE_REGIONS)
            Image.frombytes("L", (big.shape[1], big.shape[0]), big.tobytes()).save(out_dir / hd_name)
        # Palette + active CRNG cycling ranges (water/lava animation): the
        # renderer rotates these palette slots at their CRNG rates.
        cycle_src = (pal_dir / pal_name) if pal_name else src_path
        cycles = palette_cycles(cycle_src.read_bytes())
        raw = bytearray()
        for r, g, b in palette.colors:
            raw += bytes((r, g, b))
        write_json(
            out_dir / f"{name}_pal.json",
            {
                "encoding": "base64",
                "colors": base64.b64encode(bytes(raw)).decode("ascii"),
                "cycles": [{"low": c.low, "high": c.high, "msPerStep": round(c.ms_per_step, 3)} for c in cycles],
            },
        )
        entry: dict[str, object] = {
            "png": f"terrain/{name}.png",
            "indexed": f"terrain/{name}_indexed.png",
            "pal": f"terrain/{name}_pal.json",
            "width": img.width,
            "height": img.height,
            "palette": pal_name.removesuffix(".BBM").lower() if pal_name else "embedded",
        }
        if hd_name is not None:
            entry["indexed_hd"] = {"scale": SCALE, "path": f"terrain/{hd_name}"}
        textures[name] = entry

    gouraud: dict[str, object] = {}
    for src, name in _GOURAUD:
        src_path = gou_dir / src
        if not src_path.exists():
            continue
        table = load_gouraud(src_path)
        write_json(out_dir / f"{name}.json", table.to_json_dict())
        gouraud[name] = f"terrain/{name}.json"

    manifest = Manifest()
    manifest.add("terrain", {"textures": textures, "gouraud": gouraud})
    manifest.save(assets)
