"""Tests for the BOB animation container decoder."""

from __future__ import annotations

from pathlib import Path

import pytest

from s2gold.core import EXTRACTED_DIR
from s2gold.formats import bob
from s2gold.formats.palette import Palette

pytestmark = pytest.mark.assets

_HAS_ASSETS = (EXTRACTED_DIR / "DATA").is_dir()
_skip = pytest.mark.skipif(not _HAS_ASSETS, reason="extracted/ game data not present")

_CARRIER = EXTRACTED_DIR / "DATA" / "BOBS" / "CARRIER.BOB"
_JOBS = EXTRACTED_DIR / "DATA" / "BOBS" / "JOBS.BOB"


def test_index_helpers() -> None:
    # Body layout [fat][direction][animStep] with 6 directions and 8 steps.
    assert bob.body_index(False, 0, 0) == 0
    assert bob.body_index(False, 0, 1) == 1
    assert bob.body_index(True, 0, 0) == 48
    assert bob.body_index(True, 5, 7) == 95
    # Link layout [job][animStep][fat][direction].
    assert bob.link_index(0, 0, False, 0) == 0
    assert bob.link_index(0, 0, False, 5) == 5
    assert bob.link_index(1, 0, False, 0) == bob.NUM_LINKS_PER_JOB


def _palette() -> Palette:
    return Palette.from_bbm(EXTRACTED_DIR / "GFX" / "PALETTE" / "PAL5.BBM")


@_skip
def test_bad_magic_raises() -> None:
    with pytest.raises(bob.BobError, match="not a BOB"):
        bob.read_bob(b"\x00\x00\x00\x00", _palette())


@_skip
def test_carrier_decodes_with_plausible_counts() -> None:
    b = bob.read_bob(_CARRIER.read_bytes(), _palette())
    assert len(b.bodies) == bob.NUM_BODY_IMAGES == 96
    # Hundreds of overlay sprites and thousands of links.
    assert len(b.overlays) > 500
    assert len(b.links) == b.num_jobs * bob.NUM_LINKS_PER_JOB
    assert b.num_jobs > 1


@_skip
def test_carrier_links_table_is_internally_consistent() -> None:
    b = bob.read_bob(_CARRIER.read_bytes(), _palette())
    assert all(0 <= link < len(b.overlays) for link in b.links)
    # Every animation cell resolves to a real overlay sprite.
    for step in range(bob.NUM_ANIM_STEPS):
        for direction in range(bob.NUM_DIRECTIONS):
            link = b.links[bob.link_index(0, step, False, direction)]
            assert 0 <= link < len(b.overlays)


@_skip
def test_bodies_are_player_colored_sprites() -> None:
    b = bob.read_bob(_CARRIER.read_bytes(), _palette())
    body = b.bodies[bob.body_index(False, 2, 0)]
    assert body.width == bob.SPRITE_WIDTH
    assert body.nx == bob.X_OFFSET
    assert body.height > 0
    # A walking settler has player-colored clothing, so at least one body has a mask.
    assert any(s.player_mask is not None for s in b.bodies)


@_skip
def test_all_bobs_decode_fully() -> None:
    palette = _palette()
    for path in (_CARRIER, _JOBS, EXTRACTED_DIR / "DATA" / "BOBS" / "CARRIER2.BOB"):
        b = bob.read_bob(Path(path).read_bytes(), palette)
        assert len(b.bodies) == 96
        assert b.overlays and b.links
