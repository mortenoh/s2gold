"""Full-screen picture converter: GFX/PICS menu backgrounds and mission images to PNG.

The SETUP*.LBM files are the original menu/setup screens (640x480), WORLD.LBM is the
campaign world map, and GFX/PICS/MISSION/*.LBM are the per-continent mission briefing
backgrounds. Each file carries its own embedded CMAP palette.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from s2gold.core import ASSETS_DIR, Manifest, write_json
from s2gold.formats.lbm import decode_lbm
from s2gold.formats.palette import Palette

FALLBACK_PALETTE = "PAL5.BBM"


def _to_png(src: Path, dest: Path, fallback: Palette | None) -> tuple[int, int] | None:
    """Decode one LBM to an RGB PNG; returns (width, height) or None when undecodable."""
    image = decode_lbm(src.read_bytes())
    palette = image.palette or fallback
    if palette is None or image.width == 0 or image.height == 0:
        return None
    colors = palette.colors
    rgb = bytearray(image.width * image.height * 3)
    for i, idx in enumerate(image.pixels):
        r, g, b = colors[idx]
        o = i * 3
        rgb[o] = r
        rgb[o + 1] = g
        rgb[o + 2] = b
    out = Image.frombytes("RGB", (image.width, image.height), bytes(rgb))
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, optimize=True)
    return image.width, image.height


def run(extracted: Path, assets: Path = ASSETS_DIR) -> None:
    """Convert all GFX/PICS images (menu screens, world map, mission backgrounds)."""
    pics_dir = extracted / "GFX" / "PICS"
    if not pics_dir.is_dir():
        print("[pics] no GFX/PICS directory found, skipping")
        return

    fallback: Palette | None = None
    pal_path = extracted / "GFX" / "PALETTE" / FALLBACK_PALETTE
    if pal_path.is_file():
        fallback = Palette.from_bbm(pal_path)

    out_dir = assets / "pics"
    index: dict[str, dict[str, object]] = {}
    for src in sorted(pics_dir.rglob("*.LBM")):
        rel_group = "mission" if src.parent.name == "MISSION" else "setup"
        name = src.stem.lower()
        key = f"{rel_group}_{name}" if rel_group == "mission" else name
        dest = out_dir / f"{key}.png"
        size = _to_png(src, dest, fallback)
        if size is None:
            print(f"[pics] {src.name}: undecodable, skipped")
            continue
        index[key] = {"file": f"pics/{key}.png", "w": size[0], "h": size[1], "group": rel_group}
    write_json(out_dir / "index.json", index)

    manifest = Manifest()
    manifest.add("pics", {"index": "pics/index.json", "count": len(index)})
    manifest.save(assets)
    print(f"[pics] converted {len(index)} pictures -> {out_dir}")
