"""Tests for the 2x HD graphics set written by the terrain, graphics and BOB converters."""

from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from s2gold.convert import bobs, graphics, palettes, terrain
from s2gold.core import EXTRACTED_DIR, REPO_ROOT

_HAS_ASSETS = (EXTRACTED_DIR / "DATA" / "BOBS" / "CARRIER.BOB").exists()
_skip = pytest.mark.skipif(not _HAS_ASSETS, reason="extracted/ game data not present")


def _pixels(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGBA"))


def _sprite_pairs(atlas_dir: Path, meta: dict, entry: dict) -> set[tuple[bytes, int]]:
    """(rgba, player shade) pairs of one sprite's pixels."""
    x, y, w, h = entry["x"], entry["y"], entry["w"], entry["h"]
    colour = _pixels(atlas_dir / meta["atlases"][entry["atlas"]])[y : y + h, x : x + w]
    shade = np.zeros((h, w), dtype=np.uint8)
    if entry.get("pmask"):
        mask = _pixels(atlas_dir / meta["pmasks"][entry["atlas"]])
        crop = mask[y : y + h, x : x + w]
        shade[: crop.shape[0], : crop.shape[1]] = crop[..., 0]
    return {(colour[j, i].tobytes(), int(shade[j, i])) for j in range(h) for i in range(w)}


def _check_hd_archive(base: Path) -> None:
    low = json.loads((base / "atlas.json").read_text())
    high = json.loads((base / "hd2" / "atlas.json").read_text())
    assert "scale" not in low
    assert high["scale"] == 2
    assert high["sprites"].keys() == low["sprites"].keys()
    for page in high["atlases"]:
        img = Image.open(base / "hd2" / page)
        assert img.width <= 2048 and img.height <= 2048
    for key, lo in low["sprites"].items():
        hi = high["sprites"][key]
        assert (hi["w"], hi["h"], hi["nx"], hi["ny"]) == (lo["w"] * 2, lo["h"] * 2, lo["nx"] * 2, lo["ny"] * 2)
        assert hi["kind"] == lo["kind"]
        assert hi.get("pmask") == lo.get("pmask")
        assert hi.get("player_indices") == lo.get("player_indices")
    # Every magnified pixel is a copy of a source pixel, colour and player shade together.
    for key in list(low["sprites"])[::7]:
        lo, hi = low["sprites"][key], high["sprites"][key]
        if lo["w"] == 0 or lo["h"] == 0:
            continue
        assert _sprite_pairs(base / "hd2", high, hi) <= _sprite_pairs(base, low, lo), key


@_skip
def test_graphics_hd_sets(tmp_path: Path) -> None:
    palettes.run(EXTRACTED_DIR, tmp_path)
    graphics.run(EXTRACTED_DIR, tmp_path)
    manifest = json.loads((tmp_path / "manifest.json").read_text())["categories"]
    hd = manifest["graphics_hd"]
    assert hd["scale"] == 2
    assert set(hd["archives"]) == graphics.HD_ARCHIVES
    for name in ("rom_z", "mapbobs1", "cbob_rom_bobs"):
        assert hd["archives"][name] == f"graphics/{name}/hd2/atlas.json"
        _check_hd_archive(tmp_path / "graphics" / name)
    assert not (tmp_path / "graphics" / "io_dat" / "hd2").exists()


@_skip
def test_bobs_hd_sets_keep_composition_tables(tmp_path: Path) -> None:
    bobs.run(EXTRACTED_DIR, tmp_path)
    manifest = json.loads((tmp_path / "manifest.json").read_text())["categories"]
    assert set(manifest["bobs_hd"]["archives"]) == {"carrier", "jobs"}
    for name in ("carrier", "jobs"):
        base = tmp_path / "bobs" / name
        _check_hd_archive(base)
        low = json.loads((base / "atlas.json").read_text())
        high = json.loads((base / "hd2" / "atlas.json").read_text())
        for field in ("body_table", "links", "num_bodies", "overlay_base", "dims"):
            assert high[field] == low[field]
    assert not (tmp_path / "bobs" / "carrier2" / "hd2").exists()


@_skip
def test_bobs_no_hd_writes_nothing_extra(tmp_path: Path) -> None:
    bobs.run(EXTRACTED_DIR, tmp_path, hd=False)
    manifest = json.loads((tmp_path / "manifest.json").read_text())["categories"]
    assert "bobs_hd" not in manifest
    assert not list((tmp_path / "bobs").glob("*/hd2"))


@_skip
def test_terrain_hd_indices_come_from_the_same_texture(tmp_path: Path) -> None:
    terrain.run(EXTRACTED_DIR, tmp_path)
    textures = json.loads((tmp_path / "manifest.json").read_text())["categories"]["terrain"]["textures"]
    for name in ("tex5", "tex6", "tex7"):
        assert textures[name]["indexed_hd"] == {"scale": 2, "path": f"terrain/{name}_indexed_hd2.png"}
        low = np.asarray(Image.open(tmp_path / "terrain" / f"{name}_indexed.png"))
        high = np.asarray(Image.open(tmp_path / "terrain" / f"{name}_indexed_hd2.png"))
        assert high.shape == (512, 512)
        for x, y, w, h in terrain.TEXTURE_REGIONS:
            src = set(np.unique(low[y : y + h, x : x + w]))
            out = set(np.unique(high[2 * y : 2 * (y + h), 2 * x : 2 * (x + w)]))
            assert out <= src, (name, x, y)
    assert "indexed_hd" not in textures["textur_0"]


def test_texture_regions_cover_the_renderer_tables() -> None:
    source = (REPO_ROOT / "packages" / "renderer" / "src" / "terrain-data.ts").read_text()
    rects = {tuple(int(v) for v in m) for m in re.findall(r"\[(\d+), (\d+), (\d+), (\d+)\]", source)}
    rects |= {(192, 176 + 16 * slot, 64, 16) for slot in range(5)}
    assert rects <= set(terrain.TEXTURE_REGIONS)
