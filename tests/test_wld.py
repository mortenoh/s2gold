"""Tests for the WLD/SWD map parser against real Settlers II maps."""

from __future__ import annotations

import pytest

from s2gold.core import EXTRACTED_DIR
from s2gold.formats.wld import LAYER_NAMES, parse_wld

MAPS_DIR = EXTRACTED_DIR / "DATA" / "MAPS"
MISS200 = MAPS_DIR / "MISS200.WLD"

pytestmark = pytest.mark.assets


@pytest.mark.skipif(not MISS200.exists(), reason="extracted game data not present")
def test_miss200_header() -> None:
    m = parse_wld(MISS200.read_bytes())
    assert m.title == "I - Off we go"
    assert (m.width, m.height) == (64, 64)
    assert 1 <= m.player_count <= 7
    assert m.terrain in (0, 1, 2)
    assert len(m.layers) == len(LAYER_NAMES) == 14
    for plane in m.layers.values():
        assert len(plane) == m.width * m.height


@pytest.mark.skipif(not MISS200.exists(), reason="extracted game data not present")
def test_all_bundled_maps_parse() -> None:
    dirs = [EXTRACTED_DIR / "DATA" / d for d in ("MAPS", "MAPS2", "MAPS3", "MAPS4")]
    files = [f for d in dirs if d.is_dir() for f in d.glob("*.WLD")]
    assert files, "expected at least one bundled map"
    for f in files:
        m = parse_wld(f.read_bytes())
        assert len(m.layers) == 14
        assert m.width > 0 and m.height > 0
