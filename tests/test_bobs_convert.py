"""Tests for the BOB settler-animation converter."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from PIL import Image

from s2gold.convert import bobs
from s2gold.core import EXTRACTED_DIR
from s2gold.formats import bob

pytestmark = pytest.mark.assets

_HAS_ASSETS = (EXTRACTED_DIR / "DATA" / "BOBS" / "CARRIER.BOB").exists()
_skip = pytest.mark.skipif(not _HAS_ASSETS, reason="extracted/ game data not present")


@_skip
def test_bobs_converter_atlases_and_manifest(tmp_path: Path) -> None:
    bobs.run(EXTRACTED_DIR, tmp_path)

    manifest = json.loads((tmp_path / "manifest.json").read_text())
    for name in ("carrier", "carrier2", "jobs"):
        assert manifest["categories"]["bobs"][name] == f"bobs/{name}/atlas.json"

    for name in ("carrier", "carrier2", "jobs"):
        bob_dir = tmp_path / "bobs" / name
        atlas_json = json.loads((bob_dir / "atlas.json").read_text())
        assert atlas_json["name"] == name
        assert atlas_json["num_bodies"] == bob.NUM_BODY_IMAGES == 96
        assert atlas_json["atlas_count"] >= 1
        # Every referenced atlas image exists and is a valid RGBA image within bounds.
        for atlas_name in atlas_json["atlases"]:
            img = Image.open(bob_dir / atlas_name)
            assert img.mode == "RGBA"
            assert img.width <= 2048 and img.height <= 2048
        # BOB figures are player-colored, so masks must be emitted.
        assert atlas_json["pmasks"]
        for pmask_name in atlas_json["pmasks"]:
            assert (bob_dir / pmask_name).exists()


@_skip
def test_body_table_is_complete_2x6x8(tmp_path: Path) -> None:
    bobs.run(EXTRACTED_DIR, tmp_path)
    atlas_json = json.loads((tmp_path / "bobs" / "carrier" / "atlas.json").read_text())

    table = atlas_json["body_table"]
    assert len(table) == bob.NUM_FAT_TYPES == 2
    seen: set[int] = set()
    for fat in table:
        assert len(fat) == bob.NUM_DIRECTIONS == 6
        for direction in fat:
            assert len(direction) == bob.NUM_ANIM_STEPS == 8
            for body_idx in direction:
                assert 0 <= body_idx < atlas_json["num_bodies"]
                assert str(body_idx) in atlas_json["sprites"]
                seen.add(body_idx)
    # All 96 body sprites are addressed exactly once.
    assert seen == set(range(96))


@_skip
def test_links_indices_in_range(tmp_path: Path) -> None:
    bobs.run(EXTRACTED_DIR, tmp_path)
    atlas_json = json.loads((tmp_path / "bobs" / "carrier" / "atlas.json").read_text())

    links = atlas_json["links"]
    num_overlays = atlas_json["num_overlays"]
    overlay_base = atlas_json["overlay_base"]
    assert len(links) == atlas_json["num_jobs"] >= 1
    for job in links:
        assert len(job) == bob.NUM_ANIM_STEPS
        for step in job:
            assert len(step) == bob.NUM_FAT_TYPES
            for fat in step:
                assert len(fat) == bob.NUM_DIRECTIONS
                for overlay_idx in fat:
                    assert 0 <= overlay_idx < num_overlays
                    assert str(overlay_base + overlay_idx) in atlas_json["sprites"]


@_skip
def test_known_body_sprite_has_pixels_and_pmask(tmp_path: Path) -> None:
    bobs.run(EXTRACTED_DIR, tmp_path)
    bob_dir = tmp_path / "bobs" / "carrier"
    atlas_json = json.loads((bob_dir / "atlas.json").read_text())

    # A settler walking south-east (direction 2, step 0) is a real, drawn, clothed body.
    body_idx = bob.body_index(False, 2, 0)
    entry = atlas_json["sprites"][str(body_idx)]
    assert entry["kind"] == "body"
    assert entry["nx"] == bob.X_OFFSET == 16
    assert entry["w"] == bob.SPRITE_WIDTH == 32
    assert entry["h"] > 0

    # The sprite region in the colour atlas has non-transparent pixels.
    atlas = Image.open(bob_dir / atlas_json["atlases"][entry["atlas"]]).convert("RGBA")
    region = atlas.crop((entry["x"], entry["y"], entry["x"] + entry["w"], entry["y"] + entry["h"]))
    assert region.getextrema()[3][1] > 0

    # At least one body carries a player-color mask; find one and check its pmask pixels.
    masked = [(int(k), v) for k, v in atlas_json["sprites"].items() if v["kind"] == "body" and v.get("pmask")]
    assert masked, "walking settlers should have player-colored clothing"
    _, m = masked[0]
    assert m["player_indices"] == [128, 129, 130, 131]
    pmask = Image.open(bob_dir / atlas_json["pmasks"][m["atlas"]]).convert("RGBA")
    region = pmask.crop((m["x"], m["y"], m["x"] + m["w"], m["y"] + m["h"]))
    assert region.getextrema()[3][1] > 0


@_skip
def test_bobs_converter_idempotent(tmp_path: Path) -> None:
    bobs.run(EXTRACTED_DIR, tmp_path)
    first = (tmp_path / "bobs" / "carrier" / "atlas_0.png").read_bytes()
    first_json = (tmp_path / "bobs" / "carrier" / "atlas.json").read_bytes()
    bobs.run(EXTRACTED_DIR, tmp_path)
    second = (tmp_path / "bobs" / "carrier" / "atlas_0.png").read_bytes()
    second_json = (tmp_path / "bobs" / "carrier" / "atlas.json").read_bytes()
    assert first == second
    assert first_json == second_json
