"""Convert WLD/SWD maps into JSON for the browser app.

Each map is written to ``<assets>/maps/<dir>_<name>.json`` with its header fields
plus every layer as base64-encoded raw bytes (documented inline via
``"encoding": "base64"``). A ``maps/index.json`` summarizes every map (name,
title, size, players, terrain set).
"""

from __future__ import annotations

import base64
import json
from pathlib import Path

from s2gold.core import Manifest
from s2gold.formats.wld import WorldMap, parse_wld

# Directories to scan and the output prefix for maps found in each.
_MAP_DIRS: tuple[tuple[str, str, str], ...] = (
    ("DATA/MAPS", "maps", "*.WLD"),
    ("DATA/MAPS2", "maps2", "*.WLD"),
    ("DATA/MAPS3", "maps3", "*.WLD"),
    ("DATA/MAPS4", "maps4", "*.WLD"),
    ("WORLDS", "worlds", "*.SWD"),
)


def _map_to_dict(m: WorldMap) -> dict[str, object]:
    """Serialize a parsed map to a JSON-ready dict with base64 layer planes."""
    return {
        "title": m.title,
        "author": m.author,
        "width": m.width,
        "height": m.height,
        "terrain": m.terrain,
        "terrain_name": m.terrain_name,
        "players": m.player_count,
        "hq_x": m.hq_x,
        "hq_y": m.hq_y,
        "encoding": "base64",
        "layers": {name: base64.b64encode(plane).decode("ascii") for name, plane in m.layers.items()},
    }


def run(extracted: Path, assets: Path) -> None:
    """Convert every WLD/SWD map and emit maps/<dir>_<name>.json + index.json."""
    out_dir = assets / "maps"
    out_dir.mkdir(parents=True, exist_ok=True)

    index: list[dict[str, object]] = []
    for subdir, prefix, pattern in _MAP_DIRS:
        src_dir = extracted / subdir
        if not src_dir.is_dir():
            continue
        for src in sorted(src_dir.glob(pattern)):
            m = parse_wld(src.read_bytes())
            name = f"{prefix}_{src.stem.lower()}"
            (out_dir / f"{name}.json").write_text(json.dumps(_map_to_dict(m), separators=(",", ":")))
            index.append(
                {
                    "file": f"maps/{name}.json",
                    "name": name,
                    "title": m.title,
                    "width": m.width,
                    "height": m.height,
                    "players": m.player_count,
                    "terrain": m.terrain,
                    "terrain_name": m.terrain_name,
                }
            )

    (out_dir / "index.json").write_text(json.dumps({"maps": index}, separators=(",", ":")))

    manifest = Manifest()
    manifest.add("maps", {"index": "maps/index.json", "count": len(index)})
    manifest.save(assets)
