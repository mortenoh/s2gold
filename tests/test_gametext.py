"""Tests for the GER/ENG/RTX game-text parser against real files."""

from __future__ import annotations

import pytest

from s2gold.core import EXTRACTED_DIR
from s2gold.formats.gametext import is_container, parse_text

ONGAME = EXTRACTED_DIR / "DATA" / "TXT" / "ONGAME.ENG"
RTX = EXTRACTED_DIR / "DATA" / "MISSIONS" / "MIS_0000.RTX"

pytestmark = pytest.mark.assets


@pytest.mark.skipif(not ONGAME.exists(), reason="extracted game data not present")
def test_ongame_container_strings() -> None:
    data = ONGAME.read_bytes()
    assert is_container(data)
    entries = parse_text(data)
    assert len(entries) > 100
    # Spot-check a known UI string that lives at the top of ONGAME.ENG.
    assert entries[0] == "The Settlers II"
    assert any(e and "Gold Edition" in e for e in entries)


@pytest.mark.skipif(not RTX.exists(), reason="extracted game data not present")
def test_plain_rtx_single_entry() -> None:
    data = RTX.read_bytes()
    assert not is_container(data)
    entries = parse_text(data)
    assert len(entries) == 1
    assert entries[0] is not None and "GLOBAL_MAP_SETTINGS" in entries[0]
