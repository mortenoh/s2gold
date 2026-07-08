"""Tests for the IDX/DAT archive reader."""

from __future__ import annotations

import struct

import pytest

from s2gold.core import EXTRACTED_DIR
from s2gold.formats import datidx, lst

pytestmark = pytest.mark.assets

_HAS_ASSETS = (EXTRACTED_DIR / "DATA").is_dir()
_skip = pytest.mark.skipif(not _HAS_ASSETS, reason="extracted/ game data not present")


def _idx_entry(name: bytes, offset: int, bobtype: int) -> bytes:
    return name.ljust(16, b"\x00") + struct.pack("<I", offset) + bytes(6) + struct.pack("<h", bobtype)


def test_read_idx_parses_entries() -> None:
    data = struct.pack("<I", 2) + _idx_entry(b"first", 0, 3) + _idx_entry(b"second", 0x100, 5)
    entries = datidx.read_idx(data)
    assert [(e.name, e.offset, e.bobtype) for e in entries] == [("first", 0, 3), ("second", 0x100, 5)]


def test_read_idx_truncated_raises() -> None:
    data = struct.pack("<I", 5)  # claims 5 entries but has none
    with pytest.raises(datidx.DatidxError, match="declares 5 entries"):
        datidx.read_idx(data)


@_skip
def test_resource_idx_count_and_known_names() -> None:
    idx = EXTRACTED_DIR / "DATA" / "RESOURCE.IDX"
    entries = datidx.read_idx(idx.read_bytes())
    assert len(entries) == 57
    names = [e.name for e in entries]
    assert names[0] == "font11"
    assert {"font09", "font11", "font14", "roemerpal"} <= set(names)
    # The three fonts are bob-type 3, the palette is bob-type 5.
    by_name = {e.name: e for e in entries}
    assert by_name["font11"].bobtype == 3
    assert by_name["roemerpal"].bobtype == 5


@_skip
def test_resource_archive_items_parse() -> None:
    archive = datidx.read_archive(EXTRACTED_DIR / "DATA" / "RESOURCE.IDX", EXTRACTED_DIR / "DATA" / "RESOURCE.DAT")
    assert len(archive.items) == len(archive.entries) == 57
    fonts = [i for i in archive.items if isinstance(i, lst.FontItem)]
    palettes = [i for i in archive.items if isinstance(i, lst.PaletteItem)]
    bitmaps = [i for i in archive.items if isinstance(i, lst.BitmapItem)]
    assert len(fonts) == 3
    assert len(palettes) == 1
    assert len(bitmaps) == 53


@_skip
def test_io_dat_archive_all_bitmaps() -> None:
    archive = datidx.read_archive(EXTRACTED_DIR / "DATA" / "IO" / "IO.IDX", EXTRACTED_DIR / "DATA" / "IO" / "IO.DAT")
    assert len(archive.entries) == 264
    assert archive.entries[0].name == "back_00"
    assert all(isinstance(i, lst.BitmapItem) for i in archive.items)


@_skip
def test_all_idx_dat_pairs_parse_cleanly() -> None:
    data = EXTRACTED_DIR / "DATA"
    pairs = [
        (data / "RESOURCE.IDX", data / "RESOURCE.DAT"),
        (data / "EDITRES.IDX", data / "EDITRES.DAT"),
        (data / "IO" / "IO.IDX", data / "IO" / "IO.DAT"),
        (data / "IO" / "EDITIO.IDX", data / "IO" / "EDITIO.DAT"),
    ]
    for idx, dat in pairs:
        archive = datidx.read_archive(idx, dat)
        assert archive.items, f"{idx.name} produced no items"
        assert len(archive.items) == len(archive.entries)
