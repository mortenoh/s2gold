"""Tests for the font converter."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from PIL import Image

from s2gold.convert import fonts
from s2gold.core import EXTRACTED_DIR

pytestmark = pytest.mark.assets

_HAS_ASSETS = (EXTRACTED_DIR / "DATA").is_dir()
_skip = pytest.mark.skipif(not _HAS_ASSETS, reason="extracted/ game data not present")


@_skip
def test_fonts_converter_outputs_and_manifest(tmp_path: Path) -> None:
    fonts.run(EXTRACTED_DIR, tmp_path)
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    fonts_cat = manifest["categories"]["fonts"]
    assert {"font09", "font11", "font14"} <= set(fonts_cat)
    for name in ("font09", "font11", "font14"):
        assert (tmp_path / "fonts" / f"{name}.png").exists()
        assert (tmp_path / "fonts" / f"{name}.json").exists()


@_skip
def test_font_metrics_and_glyph_coverage(tmp_path: Path) -> None:
    fonts.run(EXTRACTED_DIR, tmp_path)
    font = json.loads((tmp_path / "fonts" / "font11.json").read_text())
    assert font["dx"] > 0 and font["dy"] > 0
    glyphs = font["glyphs"]
    # Printable ASCII (letters and digits) should be covered with sane dimensions.
    for ch in "ABCabc0129":
        entry = glyphs[str(ord(ch))]
        assert 0 < entry["w"] <= 64
        assert 0 < entry["h"] <= 64
    printable = [c for c in map(int, glyphs) if 0x20 <= c < 0x7F]
    assert len(printable) >= 80


@_skip
def test_font_atlas_has_opaque_glyph_pixels(tmp_path: Path) -> None:
    fonts.run(EXTRACTED_DIR, tmp_path)
    image = Image.open(tmp_path / "fonts" / "font14.png").convert("RGBA")
    assert image.mode == "RGBA"
    # Rendered glyph ink is opaque white on transparent.
    assert image.getextrema()[3][1] == 255
