"""256-color palettes: BBM (IFF CMAP) files and raw palette items embedded in LST containers."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from s2gold.formats.binio import Reader
from s2gold.formats.iff import read_form, read_form_chunks

Rgb = tuple[int, int, int]


@dataclass(frozen=True)
class Palette:
    """An ordered 256-entry RGB palette."""

    colors: tuple[Rgb, ...]

    def __post_init__(self) -> None:
        if len(self.colors) != 256:
            raise ValueError(f"palette has {len(self.colors)} colors, expected 256")

    @classmethod
    def from_cmap(cls, cmap: bytes) -> "Palette":
        """Build a palette from a 768-byte RGB CMAP payload."""
        if len(cmap) < 768:
            raise ValueError(f"CMAP payload too short: {len(cmap)}")
        return cls(tuple((cmap[i], cmap[i + 1], cmap[i + 2]) for i in range(0, 768, 3)))

    @classmethod
    def from_bbm(cls, path: Path) -> "Palette":
        """Load the first CMAP palette from a BBM/LBM IFF file."""
        _, chunks = read_form(path.read_bytes())
        if b"CMAP" not in chunks:
            raise ValueError(f"{path}: no CMAP chunk")
        return cls.from_cmap(chunks[b"CMAP"])

    @classmethod
    def from_lst_item(cls, r: Reader) -> "Palette":
        """Read an embedded LST palette item (u16 color count, then RGB triples)."""
        count = r.u16()
        if count != 256:
            raise ValueError(f"LST palette with {count} colors")
        return cls.from_cmap(r.bytes(768))


@dataclass(frozen=True)
class PaletteCycle:
    """An active DPaint CRNG palette-cycling range.

    Attributes:
        low: First palette index of the range (inclusive).
        high: Last palette index of the range (inclusive).
        ms_per_step: Milliseconds per one-slot rotation, from the CRNG rate
            (16384 rate units = 60 steps/second).
    """

    low: int
    high: int
    ms_per_step: float


def palette_cycles(data: bytes) -> list[PaletteCycle]:
    """Extract the active CRNG palette-cycling ranges from an IFF LBM/BBM file.

    S2's PAL5.BBM / TEX5.LBM carry sixteen CRNG chunks; only ranges with a
    non-zero rate cycle in game (water 240-247 and lava 248-251 in practice).
    """
    _, chunks = read_form_chunks(data)
    cycles: list[PaletteCycle] = []
    for cid, body in chunks:
        if cid != b"CRNG" or len(body) < 8:
            continue
        rate = int.from_bytes(body[2:4], "big")
        low, high = body[6], body[7]
        if rate <= 0 or high <= low:
            continue
        cycles.append(PaletteCycle(low=low, high=high, ms_per_step=16384 / rate * 1000 / 60))
    return cycles
