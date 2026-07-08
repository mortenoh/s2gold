"""256-color palettes: BBM (IFF CMAP) files and raw palette items embedded in LST containers."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from s2gold.formats.binio import Reader
from s2gold.formats.iff import read_form

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
