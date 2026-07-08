"""Converter: GFX/PALETTE/*.BBM palettes to JSON arrays of 256 ``[r, g, b]`` entries."""

from __future__ import annotations

from pathlib import Path

from s2gold.core import Manifest, write_json
from s2gold.formats.palette import Palette


def run(extracted: Path, assets: Path) -> None:
    """Convert every BBM palette to ``palettes/<name>.json`` and register them.

    Args:
        extracted: innoextract output root (contains ``GFX/PALETTE``).
        assets: Web asset output root.
    """
    src = extracted / "GFX" / "PALETTE"
    out_dir = assets / "palettes"
    index: dict[str, object] = {}
    for bbm in sorted(src.glob("*.BBM")):
        palette = Palette.from_bbm(bbm)
        name = bbm.stem.lower()
        write_json(out_dir / f"{name}.json", [list(color) for color in palette.colors])
        index[name] = f"palettes/{name}.json"
        print(f"[palettes] {name}: 256 colors")
    manifest = Manifest()
    manifest.add("palettes", index)
    manifest.save(assets)
