"""Tests for the IDX/DAT UI archive converter."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from PIL import Image

from s2gold.convert import graphics, palettes, ui
from s2gold.core import EXTRACTED_DIR

pytestmark = pytest.mark.assets

_HAS_ASSETS = (EXTRACTED_DIR / "DATA").is_dir()
_skip = pytest.mark.skipif(not _HAS_ASSETS, reason="extracted/ game data not present")


@_skip
def test_ui_converter_schema_and_output(tmp_path: Path) -> None:
    ui.run(EXTRACTED_DIR, tmp_path)

    atlas_json = json.loads((tmp_path / "graphics" / "io_dat" / "atlas.json").read_text())
    assert atlas_json["archive"] == "io_dat"
    assert atlas_json["atlas_count"] >= 1
    assert len(atlas_json["sprites"]) == 264

    for entry in atlas_json["sprites"].values():
        assert {"name", "atlas", "x", "y", "w", "h", "nx", "ny", "kind"} <= set(entry)
        assert entry["kind"] in {"rle", "player", "shadow", "raw"}

    for atlas_name in atlas_json["atlases"]:
        img = Image.open(tmp_path / "graphics" / "io_dat" / atlas_name)
        assert img.mode == "RGBA"
        assert img.width <= 2048 and img.height <= 2048


@_skip
def test_ui_resource_skips_fonts_and_palette(tmp_path: Path) -> None:
    ui.run(EXTRACTED_DIR, tmp_path)
    atlas_json = json.loads((tmp_path / "graphics" / "resource" / "atlas.json").read_text())
    assert atlas_json["skipped"]["font"] == 3
    assert atlas_json["skipped"]["palette"] == 1
    assert len(atlas_json["sprites"]) == 53
    # Sprites keep their IDX names.
    names = {e["name"] for e in atlas_json["sprites"].values()}
    assert any(n.startswith("msk_") for n in names)


@_skip
def test_ui_extends_graphics_manifest_without_clobbering(tmp_path: Path) -> None:
    palettes.run(EXTRACTED_DIR, tmp_path)
    graphics.run(EXTRACTED_DIR, tmp_path)
    before = set(json.loads((tmp_path / "manifest.json").read_text())["categories"]["graphics"])
    assert "mapbobs" in before

    ui.run(EXTRACTED_DIR, tmp_path)
    after = json.loads((tmp_path / "manifest.json").read_text())["categories"]["graphics"]
    # Existing graphics entries survive and the UI archives are added.
    assert before <= set(after)
    assert {"resource", "io_dat", "editio", "editres"} <= set(after)


@_skip
def test_ui_converter_idempotent(tmp_path: Path) -> None:
    ui.run(EXTRACTED_DIR, tmp_path)
    first = (tmp_path / "graphics" / "io_dat" / "atlas_0.png").read_bytes()
    ui.run(EXTRACTED_DIR, tmp_path)
    second = (tmp_path / "graphics" / "io_dat" / "atlas_0.png").read_bytes()
    assert first == second
