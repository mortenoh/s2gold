"""Tests for the bitmap decoders."""

from __future__ import annotations

import struct

import pytest

from s2gold.core import EXTRACTED_DIR
from s2gold.formats import lst
from s2gold.formats.bitmaps import SHADOW_ALPHA, decode_bitmap
from s2gold.formats.palette import Palette

pytestmark = pytest.mark.assets

_HAS_ASSETS = (EXTRACTED_DIR / "DATA").is_dir()
_skip = pytest.mark.skipif(not _HAS_ASSETS, reason="extracted/ game data not present")


def _solid_palette() -> Palette:
    """A palette where index i maps to (i, i, i) so decoded colours are checkable."""
    return Palette(tuple((i, i, i) for i in range(256)))


def _alpha_count(rgba: bytes) -> int:
    """Count opaque pixels (alpha > 0) in an RGBA buffer."""
    return sum(1 for i in range(3, len(rgba), 4) if rgba[i])


def test_decode_raw_is_opaque() -> None:
    item = lst.BitmapItem(0, lst.BOB_BITMAP_RAW, "raw", 1, 2, 2, 2, bytes([10, 20, 30, 40]))
    sprite = decode_bitmap(item, _solid_palette())
    assert sprite.width == 2 and sprite.height == 2 and (sprite.nx, sprite.ny) == (1, 2)
    assert len(sprite.rgba) == 2 * 2 * 4
    assert _alpha_count(sprite.rgba) == 4
    assert sprite.rgba[0:4] == bytes([10, 10, 10, 255])


def test_decode_rle_line() -> None:
    # One 4px line: 0xFF ends after opaque(2) + transparent(2).
    block = struct.pack("<H", 2) + bytes([0x02, 0x05, 0x06, 0x02, 0xFF])
    item = lst.BitmapItem(0, lst.BOB_BITMAP_RLE, "rle", 0, 0, 4, 1, block)
    sprite = decode_bitmap(item, _solid_palette())
    assert sprite.rgba[0:4] == bytes([5, 5, 5, 255])
    assert sprite.rgba[4:8] == bytes([6, 6, 6, 255])
    assert sprite.rgba[8:12] == bytes([0, 0, 0, 0])
    assert sprite.rgba[12:16] == bytes([0, 0, 0, 0])


def test_decode_shadow_alpha() -> None:
    # 4px line: transparent(1), shadow(2), then 0xFF.
    block = struct.pack("<H", 2) + bytes([0x01, 0x02, 0xFF])
    item = lst.BitmapItem(0, lst.BOB_BITMAP_SHADOW, "shadow", 0, 0, 4, 1, block)
    sprite = decode_bitmap(item, _solid_palette())
    assert sprite.rgba[3] == 0  # first pixel transparent
    assert sprite.rgba[7] == SHADOW_ALPHA
    assert sprite.rgba[11] == SHADOW_ALPHA
    assert sprite.rgba[4:7] == bytes([0, 0, 0])  # shadow is black


def test_decode_player_color_and_mask() -> None:
    # 4px line: transparent(1), player-run of 2 with shade 1, single-colour run of 1.
    block = struct.pack("<H", 2) + bytes([0x01, 0x82, 0x01, 0xC1, 0x09])
    item = lst.BitmapItem(0, lst.BOB_BITMAP_PLAYER, "player", 0, 0, 4, 1, block)
    sprite = decode_bitmap(item, _solid_palette())
    assert sprite.player_mask is not None
    assert list(sprite.player_mask) == [0, 2, 2, 0]  # shade+1 for the two player pixels
    assert sprite.player_indices == (128, 129, 130, 131)
    # player pixels rendered from palette index 128 + shade(1) == 129
    assert sprite.rgba[4:8] == bytes([129, 129, 129, 255])
    assert sprite.rgba[12:16] == bytes([9, 9, 9, 255])


@_skip
def test_mapbobs_decodes_all_without_error() -> None:
    items = lst.read_lst((EXTRACTED_DIR / "DATA" / "MAPBOBS.LST").read_bytes())
    palette = next(i.palette for i in items if isinstance(i, lst.PaletteItem))
    count = 0
    for item in items:
        if isinstance(item, lst.BitmapItem):
            sprite = decode_bitmap(item, palette)
            assert len(sprite.rgba) == sprite.width * sprite.height * 4
            count += 1
    assert count > 1000


@_skip
def test_known_boat_sprite_dimensions_and_content() -> None:
    items = lst.read_lst((EXTRACTED_DIR / "DATA" / "BOBS" / "BOAT.LST").read_bytes())
    palette = Palette.from_bbm(EXTRACTED_DIR / "GFX" / "PALETTE" / "PAL5.BBM")
    first = next(i for i in items if isinstance(i, lst.BitmapItem))
    sprite = decode_bitmap(first, palette)
    assert 8 <= sprite.width <= 64 and 8 <= sprite.height <= 64
    assert _alpha_count(sprite.rgba) > 0
    assert sprite.player_mask is not None  # boats carry a player-coloured rower
