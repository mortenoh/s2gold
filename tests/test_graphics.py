"""Tests for the palette and graphics converters and the atlas packer."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from PIL import Image

from s2gold.atlas import AtlasPacker, SpriteInput
from s2gold.convert import graphics, palettes
from s2gold.core import EXTRACTED_DIR

pytestmark = pytest.mark.assets

_HAS_ASSETS = (EXTRACTED_DIR / "DATA").is_dir()
_skip = pytest.mark.skipif(not _HAS_ASSETS, reason="extracted/ game data not present")


def test_atlas_packer_places_and_trims(tmp_path: Path) -> None:
    packer = AtlasPacker(max_size=64)
    red = bytes([255, 0, 0, 255]) * (10 * 10)
    for key in range(3):
        packer.add(SpriteInput(key, 10, 10, red))
    placements = packer.save(tmp_path, prefix="atlas")
    assert len(placements) == 3
    assert {p.key for p in placements} == {0, 1, 2}
    # distinct x positions on the same shelf
    assert len({p.x for p in placements}) == 3
    img = Image.open(tmp_path / "atlas_0.png")
    assert img.mode == "RGBA"
    assert img.width <= 64 and img.height <= 64


def test_atlas_packer_wraps_to_new_atlas() -> None:
    packer = AtlasPacker(max_size=16)
    tile = bytes([1, 2, 3, 255]) * (16 * 16)
    packer.add(SpriteInput(0, 16, 16, tile))
    packer.add(SpriteInput(1, 16, 16, tile))
    assert packer.atlas_count == 2


@_skip
def test_palettes_converter(tmp_path: Path) -> None:
    palettes.run(EXTRACTED_DIR, tmp_path)
    pal5 = json.loads((tmp_path / "palettes" / "pal5.json").read_text())
    assert len(pal5) == 256
    assert all(len(entry) == 3 for entry in pal5)
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert "pal5" in manifest["categories"]["palettes"]


@_skip
def test_graphics_converter_schema_and_output(tmp_path: Path) -> None:
    palettes.run(EXTRACTED_DIR, tmp_path)
    graphics.run(EXTRACTED_DIR, tmp_path)

    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert "mapbobs" in manifest["categories"]["graphics"]

    atlas_json = json.loads((tmp_path / "graphics" / "mapbobs" / "atlas.json").read_text())
    assert atlas_json["archive"] == "mapbobs"
    assert atlas_json["atlas_count"] >= 1
    assert atlas_json["skipped"]["palette"] == 1
    assert len(atlas_json["sprites"]) > 1000

    for entry in atlas_json["sprites"].values():
        assert {"atlas", "x", "y", "w", "h", "nx", "ny", "kind"} <= set(entry)
        assert entry["kind"] in {"rle", "player", "shadow", "raw"}

    for atlas_name in atlas_json["atlases"]:
        img = Image.open(tmp_path / "graphics" / "mapbobs" / atlas_name)
        assert img.mode == "RGBA"
        assert img.width <= 2048 and img.height <= 2048


@_skip
def test_graphics_converter_cbob_work_animations(tmp_path: Path) -> None:
    palettes.run(EXTRACTED_DIR, tmp_path)
    graphics.run(EXTRACTED_DIR, tmp_path)

    manifest = json.loads((tmp_path / "manifest.json").read_text())
    # The CBOB work-animation archive is namespaced so it does not collide with the
    # MBOB building-graphics archive that keeps the bare `rom_bobs` name.
    assert "cbob_rom_bobs" in manifest["categories"]["graphics"]
    assert "rom_bobs" in manifest["categories"]["graphics"]

    cbob_dir = tmp_path / "graphics" / "cbob_rom_bobs"
    atlas_json = json.loads((cbob_dir / "atlas.json").read_text())
    assert atlas_json["archive"] == "cbob_rom_bobs"
    # Every item in this archive is a player-colour figure, so it carries masks.
    assert atlas_json["pmasks"]
    assert len(atlas_json["sprites"]) > 1000
    # Spot-check the work-animation frames the renderer indexes (woodcutter chop 16,
    # fisher 108, farmer 132); all are player-colour bitmaps.
    for idx in ("16", "108", "132"):
        assert idx in atlas_json["sprites"]
        assert atlas_json["sprites"][idx]["kind"] == "player"

    # Distinct output from the MBOB rom_bobs building archive (different sprite counts).
    mbob = json.loads((tmp_path / "graphics" / "rom_bobs" / "atlas.json").read_text())
    assert mbob["archive"] == "rom_bobs"
    assert len(mbob["sprites"]) != len(atlas_json["sprites"])


@_skip
def test_graphics_converter_player_masks(tmp_path: Path) -> None:
    palettes.run(EXTRACTED_DIR, tmp_path)
    graphics.run(EXTRACTED_DIR, tmp_path)
    boat_dir = tmp_path / "graphics" / "boat"
    atlas_json = json.loads((boat_dir / "atlas.json").read_text())
    assert atlas_json["pmasks"], "boat sprites should produce player masks"
    assert (boat_dir / "pmasks_stub.png").exists() is False
    assert (boat_dir / atlas_json["pmasks"][0]).exists()
    masked = [e for e in atlas_json["sprites"].values() if e.get("pmask")]
    assert masked and masked[0]["player_indices"] == [128, 129, 130, 131]
    # the colour atlas has non-transparent pixels
    atlas = Image.open(boat_dir / atlas_json["atlases"][0]).convert("RGBA")
    assert atlas.getextrema()[3][1] > 0


@_skip
def test_graphics_converter_idempotent(tmp_path: Path) -> None:
    palettes.run(EXTRACTED_DIR, tmp_path)
    graphics.run(EXTRACTED_DIR, tmp_path)
    first = (tmp_path / "graphics" / "boat" / "atlas_0.png").read_bytes()
    graphics.run(EXTRACTED_DIR, tmp_path)
    second = (tmp_path / "graphics" / "boat" / "atlas_0.png").read_bytes()
    assert first == second
