"""Tests for LBM image decoding against real Settlers II texture files."""

from __future__ import annotations

import pytest

from s2gold.core import EXTRACTED_DIR
from s2gold.formats.lbm import decode_lbm

TEX5 = EXTRACTED_DIR / "GFX" / "TEXTURES" / "TEX5.LBM"

pytestmark = pytest.mark.assets


@pytest.mark.skipif(not TEX5.exists(), reason="extracted game data not present")
def test_tex5_decodes_256x256() -> None:
    img = decode_lbm(TEX5.read_bytes())
    assert (img.width, img.height) == (256, 256)
    assert len(img.pixels) == 256 * 256
    assert img.palette is not None
    assert len(img.palette.colors) == 256


@pytest.mark.skipif(not TEX5.exists(), reason="extracted game data not present")
def test_all_textures_decode() -> None:
    tex_dir = EXTRACTED_DIR / "GFX" / "TEXTURES"
    for name in ("TEX5.LBM", "TEX6.LBM", "TEX7.LBM", "TEXTUR_0.LBM", "TEXTUR_3.LBM"):
        img = decode_lbm((tex_dir / name).read_bytes())
        assert len(img.pixels) == img.width * img.height
