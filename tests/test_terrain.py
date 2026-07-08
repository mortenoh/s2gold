"""Tests for gouraud tables and the terrain converter."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from s2gold.convert import terrain
from s2gold.core import EXTRACTED_DIR
from s2gold.formats.gouraud import load_gouraud

GOU_DIR = EXTRACTED_DIR / "DATA" / "TEXTURES"
GOU5 = GOU_DIR / "GOU5.DAT"

pytestmark = pytest.mark.assets


@pytest.mark.skipif(not GOU5.exists(), reason="extracted game data not present")
def test_gouraud_tables_are_65536_bytes() -> None:
    for name in ("GOU5.DAT", "GOU6.DAT", "GOU7.DAT"):
        table = load_gouraud(GOU_DIR / name)
        assert len(table.data) == 65536
        # Row 64 is the neutral (identity) row: table[64][i] == i.
        assert all(table.lookup(64, i) == i for i in range(256))


@pytest.mark.skipif(not GOU5.exists(), reason="extracted game data not present")
def test_terrain_converter_emits_pngs_and_json(tmp_path: Path) -> None:
    terrain.run(EXTRACTED_DIR, tmp_path)
    out = tmp_path / "terrain"
    assert (out / "tex5.png").exists()
    assert (out / "tex5_indexed.png").exists()
    gou = json.loads((out / "gouraud5.json").read_text())
    assert gou["rows"] == 256 and gou["cols"] == 256 and gou["encoding"] == "base64"
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert "terrain" in manifest["categories"]
