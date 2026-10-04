"""Wildlife conversion keeps footer multiplicity without duplicating its layer."""

import struct

import pytest

from s2gold.convert.maps import _animals
from s2gold.core import EXTRACTED_DIR
from s2gold.formats.wld import WorldMap, parse_wld


def world(trailing: bytes = b"\xff") -> WorldMap:
    return WorldMap(
        title="",
        author="",
        width=4,
        height=3,
        terrain=0,
        player_count=0,
        hq_x=[],
        hq_y=[],
        header_extra=b"",
        preview=b"",
        layers={"animals": bytes([0, 1] + [0] * 10)},
        trailing=trailing,
    )


def test_footer_preserves_two_animals_on_one_node() -> None:
    footer = struct.pack("<BHHBHH", 3, 2, 1, 3, 2, 1) + b"\xff"
    assert _animals(world(footer)) == [{"species": 3, "x": 2, "y": 1}] * 2


def test_layer_fallback_and_cropped_footer() -> None:
    assert _animals(world()) == [{"species": 1, "x": 1, "y": 0}]
    assert _animals(world(struct.pack("<BHH", 3, 2, 9) + b"\xff")) == []


def test_truncated_footer_is_rejected() -> None:
    with pytest.raises(ValueError, match="footer"):
        _animals(world(b"\x01\x02\xff"))


@pytest.mark.assets
@pytest.mark.skipif(not (EXTRACTED_DIR / "DATA/MAPS2").exists(), reason="game data absent")
def test_all_shipped_footer_positions_match_layers() -> None:
    for folder in ("MAPS", "MAPS2", "MAPS3", "MAPS4"):
        for path in (EXTRACTED_DIR / "DATA" / folder).glob("*.WLD"):
            m = parse_wld(path.read_bytes())
            for a in _animals(m):
                assert m.layers["animals"][a["y"] * m.width + a["x"]] == a["species"], path.name
