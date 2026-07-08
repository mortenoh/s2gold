"""Tests for the LST container walker."""

from __future__ import annotations

import struct
from pathlib import Path

import pytest

from s2gold.core import EXTRACTED_DIR
from s2gold.formats import lst

pytestmark = pytest.mark.assets

_HAS_ASSETS = (EXTRACTED_DIR / "DATA").is_dir()
_skip = pytest.mark.skipif(not _HAS_ASSETS, reason="extracted/ game data not present")


def _build_minimal_lst() -> bytes:
    """Build a tiny in-memory LST with an unused slot, a sound, and a raw bitmap."""
    out = bytearray()
    out += struct.pack("<H", lst.LST_MAGIC)
    out += struct.pack("<I", 3)
    out += struct.pack("<h", 0)  # slot 0: unused
    out += struct.pack("<h", 1)  # slot 1: used
    out += struct.pack("<h", lst.BOB_SOUND)
    out += struct.pack("<I", 4) + b"\x01\x02\x03\x04"
    out += struct.pack("<h", 1)  # slot 2: used
    out += struct.pack("<h", lst.BOB_BITMAP_RAW)
    pixels = bytes(range(4))
    out += struct.pack("<H", 1) + struct.pack("<I", len(pixels)) + pixels
    out += struct.pack("<hhHH", -3, 5, 2, 2) + bytes(8)  # footer nx, ny, w, h + reserved
    return bytes(out)


def test_read_minimal_lst() -> None:
    items = lst.read_lst(_build_minimal_lst())
    assert len(items) == 2
    sound, bitmap = items
    assert isinstance(sound, lst.SoundItem)
    assert sound.index == 1
    assert sound.data == b"\x01\x02\x03\x04"
    assert isinstance(bitmap, lst.BitmapItem)
    assert bitmap.index == 2
    assert (bitmap.kind, bitmap.nx, bitmap.ny, bitmap.width, bitmap.height) == ("raw", -3, 5, 2, 2)


def test_bad_magic_raises() -> None:
    with pytest.raises(lst.LstError, match="not an LST"):
        lst.read_lst(struct.pack("<H", 0x1234) + struct.pack("<I", 0))


def test_unknown_bobtype_reports_index_and_offset() -> None:
    data = struct.pack("<H", lst.LST_MAGIC) + struct.pack("<I", 1)
    data += struct.pack("<h", 1) + struct.pack("<h", 99)
    with pytest.raises(lst.LstError, match="item 0"):
        lst.read_lst(data)


@_skip
def test_sound_lst_has_200_slots_55_used() -> None:
    data = (EXTRACTED_DIR / "DATA" / "SOUNDDAT" / "SOUND.LST").read_bytes()
    items = lst.read_lst(data)
    assert struct.unpack_from("<I", data, 2)[0] == 200
    assert len(items) == 55
    assert all(isinstance(item, lst.SoundItem) for item in items)


@_skip
def test_mapbobs_parses_fully_with_expected_types() -> None:
    items = lst.read_lst((EXTRACTED_DIR / "DATA" / "MAPBOBS.LST").read_bytes())
    kinds = [i.kind for i in items if isinstance(i, lst.BitmapItem)]
    palettes = [i for i in items if isinstance(i, lst.PaletteItem)]
    assert len(palettes) == 1
    assert kinds.count("rle") == 754
    assert kinds.count("shadow") == 306
    assert kinds.count("player") == 27


@_skip
def test_io_lst_raw_bitmaps() -> None:
    items = lst.read_lst((EXTRACTED_DIR / "DATA" / "IO.LST").read_bytes())
    raws = [i for i in items if isinstance(i, lst.BitmapItem) and i.kind == "raw"]
    assert len(raws) == 12
    first = next(i for i in raws if i.width == 64)
    assert first.width == 64 and first.height == 64
    assert len(first.payload) == 64 * 64


@_skip
def test_embedded_palette_is_valid() -> None:
    items = lst.read_lst((EXTRACTED_DIR / "DATA" / "MAPBOBS.LST").read_bytes())
    palette_item = next(i for i in items if isinstance(i, lst.PaletteItem))
    assert len(palette_item.palette.colors) == 256


@_skip
def test_all_graphics_archives_walk_cleanly() -> None:
    data_dir = EXTRACTED_DIR / "DATA"
    archives = sorted(data_dir.glob("*.LST")) + sorted((data_dir / "MBOB").glob("*.LST"))
    archives.append(data_dir / "BOBS" / "BOAT.LST")
    for path in archives:
        items = lst.read_lst(Path(path).read_bytes())
        assert items, f"{path.name} produced no items"
