"""GOU*.DAT / GOURAUD*.DAT gouraud shading lookup tables.

Each ``DATA/TEXTURES/GOU{5,6,7}.DAT`` file is a raw 256x256 = 65536-byte lookup
table used to apply per-vertex lighting to terrain without touching the RGB
palette. Layout (verified against the real data and the settlers2.net lighting
article, https://settlers2.net/2023/07/how-palette-and-lighting-works-in-the-settlers-2/):

* The table is row-major: ``output = table[brightness * 256 + palette_index]``.
* The first index (row) is the **brightness / shade level** 0..255.
* The second index (column) is the source **palette index** 0..255.
* Each cell holds the resulting (shaded) palette index.
* Row **64** (``0x40``) is the identity row -- brightness 64 means "no shading"
  (``table[64][i] == i`` for all ``i``). Rows below 64 progressively darken a
  color (map it toward darker palette entries); rows above 64 brighten it.

The per-vertex shading value stored in a map's shading layer (0..128, neutral 64)
is used directly as the ``brightness`` row index, letting the renderer pick a
palette-correct shaded color for every terrain vertex.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from pathlib import Path

_SIZE = 256 * 256
_NEUTRAL_ROW = 64


@dataclass(frozen=True)
class GouraudTable:
    """A 256x256 gouraud shading lookup table.

    Attributes:
        data: The raw 65536-byte LUT, row-major (``brightness * 256 + index``).
    """

    data: bytes

    def __post_init__(self) -> None:
        if len(self.data) != _SIZE:
            raise ValueError(f"gouraud table is {len(self.data)} bytes, expected {_SIZE}")

    def lookup(self, brightness: int, index: int) -> int:
        """Return the shaded palette index for ``index`` at the given brightness.

        Args:
            brightness: Shade/light level row (0..255; 64 is neutral).
            index: Source palette index column (0..255).

        Returns:
            The resulting palette index.
        """
        return self.data[(brightness & 0xFF) * 256 + (index & 0xFF)]

    def to_json_dict(self) -> dict[str, object]:
        """Serialize to a compact, loadable JSON-ready dict (base64 payload)."""
        return {
            "rows": 256,
            "cols": 256,
            "neutral_row": _NEUTRAL_ROW,
            "layout": "row-major: table[brightness*256 + palette_index] -> palette_index",
            "encoding": "base64",
            "data": base64.b64encode(self.data).decode("ascii"),
        }


def load_gouraud(path: Path) -> GouraudTable:
    """Load a ``GOU*.DAT`` gouraud shading table from disk.

    Args:
        path: Path to the ``.DAT`` file.

    Returns:
        The parsed lookup table.
    """
    return GouraudTable(path.read_bytes())
