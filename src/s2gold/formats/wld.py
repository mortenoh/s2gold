"""WLD/SWD world map parser for The Settlers II.

Implemented from the prose specs at
https://settlers2.net/documentation/world-map-file-format-wldswd/ and the
independent format notes for the RttR map editor, cross-checked against the real
game data on disk.

File layout (little-endian throughout, verified against ``DATA/MAPS/MISS200.WLD``):

Fixed header (92 bytes)::

    offset  size  field
    0       10    magic          b"WORLD_V1.0"
    10      20    title          NUL-padded map name
    30      2     width          u16 map width  (unreliable: 0/garbage on some maps)
    32      2     height         u16 map height (unreliable: use the marker dims below)
    34      1     terrain        landscape/palette set: 0=Greenland 1=Wasteland 2=Winter
    35      1     player_count   number of players (0..7)
    36      20    author         NUL-padded author name
    56      14    hq_x           7 x u16 headquarters X (0xFFFF = unused)
    70      14    hq_y           7 x u16 headquarters Y (0xFFFF = unused)
    84      8     header_extra   validity flag byte + 7 per-player nation bytes

Then a fixed 2250-byte "passable areas" preview block (250 records x 9 bytes),
followed by a 10-byte data-region marker::

    magic u16 = 0x2711 ("11 27"), dummy u32, width u16, height u16

Then exactly 14 data blocks, each a 16-byte header + ``width * height`` bytes::

    magic u16 = 0x2710 ("10 27"), dummy u32, width u16, height u16,
    multiplier u16, length u32 (== width * height)

The file ends with a single ``0xFF`` byte; some maps append an optional animal
position list after it (captured here as ``trailing`` bytes, losslessly).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from s2gold.formats.binio import Reader

MAGIC = b"WORLD_V1.0"
_HEADER_END_MAGIC = 0x2711
_BLOCK_MAGIC = 0x2710
_PREVIEW_SIZE = 2250
_NUM_BLOCKS = 14

# Ordered names of the 14 data blocks, per settlers2.net.
LAYER_NAMES: tuple[str, ...] = (
    "height",  # 1: elevation values (0..60)
    "texture1",  # 2: terrain texture, up-pointing triangle (RSU)
    "texture2",  # 3: terrain texture, down-pointing triangle (LSD)
    "roads",  # 4: road network
    "object_index",  # 5: object index / animation frame
    "object_type",  # 6: object type / classification
    "animals",  # 7: wildlife type
    "unknown1",  # 8: internal/savegame (0x00 in WLD/SWD)
    "build",  # 9: buildable-site flags
    "unknown2",  # 10: internal/savegame (filled with 0x07)
    "unknown3",  # 11: editor cursor marker
    "resources",  # 12: mineable resources / water
    "shading",  # 13: gouraud lighting values (neutral 64)
    "owner",  # 14: ownership / border zones
)

TERRAIN_NAMES: dict[int, str] = {0: "greenland", 1: "wasteland", 2: "winter"}


@dataclass
class WorldMap:
    """A parsed WLD/SWD map.

    Attributes:
        title: Map name.
        author: Author name.
        width: Map width in vertices.
        height: Map height in vertices.
        terrain: Landscape/palette set (0=greenland, 1=wasteland, 2=winter).
        player_count: Number of players.
        hq_x: Seven headquarters X coordinates (0xFFFF means unused).
        hq_y: Seven headquarters Y coordinates (0xFFFF means unused).
        header_extra: The 8 trailing header bytes (validity flag + nations).
        preview: Raw 2250-byte passable-areas preview block.
        layers: Ordered mapping of layer name to its raw ``width * height`` bytes.
        trailing: Any bytes after the final block (terminator + optional lists).
    """

    title: str
    author: str
    width: int
    height: int
    terrain: int
    player_count: int
    hq_x: list[int]
    hq_y: list[int]
    header_extra: bytes
    preview: bytes
    layers: dict[str, bytes] = field(default_factory=dict)
    trailing: bytes = b""

    @property
    def terrain_name(self) -> str:
        """Human-readable landscape name for the terrain set."""
        return TERRAIN_NAMES.get(self.terrain, f"unknown{self.terrain}")


def parse_wld(data: bytes) -> WorldMap:
    """Parse a WLD/SWD map file into a :class:`WorldMap`.

    Args:
        data: Raw bytes of the ``.WLD``/``.SWD`` file.

    Returns:
        The parsed map with all 14 layers as raw byte planes.

    Raises:
        ValueError: When the magic, block markers, or block count are wrong.
    """
    r = Reader(data)
    if r.bytes(10) != MAGIC:
        raise ValueError("not a WLD/SWD file (missing WORLD_V1.0 magic)")
    title = r.cstr(20)
    r.u16()  # header width field is unreliable (0/garbage on some maps); use the marker below
    r.u16()  # header height field (likewise unreliable)
    terrain = r.u8()
    player_count = r.u8()
    author = r.cstr(20)
    hq_x = [r.u16() for _ in range(7)]
    hq_y = [r.u16() for _ in range(7)]
    header_extra = r.bytes(8)
    preview = r.bytes(_PREVIEW_SIZE)

    marker = r.u16()
    if marker != _HEADER_END_MAGIC:
        raise ValueError(f"expected data-region marker 0x{_HEADER_END_MAGIC:04x}, got 0x{marker:04x}")
    r.bytes(4)  # dummy
    # The marker carries the authoritative map dimensions (the fixed-header ones above
    # are 0/garbage on several bundled maps); the block headers repeat these values.
    width = r.u16()
    height = r.u16()

    layers: dict[str, bytes] = {}
    for i in range(_NUM_BLOCKS):
        block_magic = r.u16()
        if block_magic != _BLOCK_MAGIC:
            raise ValueError(f"block {i}: expected magic 0x{_BLOCK_MAGIC:04x}, got 0x{block_magic:04x}")
        r.bytes(4)  # dummy
        bw = r.u16()
        bh = r.u16()
        r.u16()  # multiplier (always 1)
        length = r.u32()
        if length != bw * bh:
            raise ValueError(f"block {i}: length {length} != {bw}*{bh}")
        layers[LAYER_NAMES[i]] = r.bytes(length)

    trailing = r.bytes(r.remaining())
    return WorldMap(
        title=title,
        author=author,
        width=width,
        height=height,
        terrain=terrain,
        player_count=player_count,
        hq_x=hq_x,
        hq_y=hq_y,
        header_extra=header_extra,
        preview=preview,
        layers=layers,
        trailing=trailing,
    )
