"""Decoders for The Settlers II bitmap items into RGBA pixel buffers.

Four encodings are supported, all producing a straight RGBA buffer plus the sprite's
anchor point:

* **raw** (type 14): ``width * height`` paletted bytes, fully opaque.
* **rle** (type 2): per-line runs alternating opaque/transparent, ``0xFF`` ends a line.
* **player** (type 4): command-byte stream with transparent, raw-copy, player-color and
  single-color-run opcodes; player-color pixels also yield a shade mask for runtime
  recoloring.
* **shadow** (type 7): per-line monochrome runs alternating transparent/shadow, ``0xFF``
  ends a line; shadow pixels are emitted as semi-transparent black.

Transparent runs and unwritten trailing pixels are left fully transparent via the alpha
channel. Encodings and opcode semantics were verified byte-exactly against the game data
(each decoded line consumes exactly up to the next line offset).
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

from s2gold.formats.lst import BitmapItem
from s2gold.formats.palette import Palette

# First palette index of the 4-shade player-color ramp (blue for the default player).
PLAYER_COLOR_BASE = 128
PLAYER_COLOR_COUNT = 4

# Alpha applied to shadow pixels (semi-transparent black overlay).
SHADOW_ALPHA = 0x40

_LINE_END = 0xFF


@dataclass(frozen=True)
class DecodedSprite:
    """A decoded sprite: RGBA pixels plus anchor and optional player-color mask.

    Attributes:
        width: Width in pixels.
        height: Height in pixels.
        nx: Anchor/hotspot X.
        ny: Anchor/hotspot Y.
        kind: Source encoding ("raw", "rle", "player", "shadow").
        rgba: ``width * height * 4`` straight-alpha RGBA bytes.
        player_mask: For player sprites, ``width * height`` bytes where ``0`` means "not
            player-colored" and ``shade + 1`` (1-4) marks a player-color pixel of that
            shade; ``None`` for other kinds and for player sprites with no such pixels.
        player_indices: Palette indices used to render player-color pixels in the base
            image (the default-player ramp), empty when there is no player mask.
    """

    width: int
    height: int
    nx: int
    ny: int
    kind: str
    rgba: bytes
    player_mask: bytes | None
    player_indices: tuple[int, ...]


def decode_bitmap(item: BitmapItem, palette: Palette) -> DecodedSprite:
    """Decode a bitmap item into a :class:`DecodedSprite` using the given palette.

    Args:
        item: The undecoded bitmap item from the LST walker.
        palette: The palette to resolve paletted indices against.

    Returns:
        The decoded sprite.

    Raises:
        ValueError: If the item's kind is not a known bitmap encoding.
    """
    if item.kind == "raw":
        return _decode_raw(item, palette)
    if item.kind == "rle":
        return _decode_rle(item, palette)
    if item.kind == "player":
        return _decode_player(item, palette)
    if item.kind == "shadow":
        return _decode_shadow(item)
    raise ValueError(f"item {item.index}: unknown bitmap kind {item.kind!r}")


def _line_offsets(block: bytes, height: int) -> list[int]:
    """Read the per-line start offsets (``height`` little-endian u16s) from a block."""
    return list(struct.unpack_from(f"<{height}H", block, 0))


def _empty_sprite(item: BitmapItem, kind: str) -> DecodedSprite:
    """Return a zero-sized transparent sprite (preserving the anchor)."""
    return DecodedSprite(item.width, item.height, item.nx, item.ny, kind, b"", None, ())


def _decode_raw(item: BitmapItem, palette: Palette) -> DecodedSprite:
    """Decode an uncompressed, fully opaque paletted bitmap (type 14)."""
    colors = palette.colors
    out = bytearray(item.width * item.height * 4)
    for i, idx in enumerate(item.payload[: item.width * item.height]):
        r, g, b = colors[idx]
        o = i * 4
        out[o] = r
        out[o + 1] = g
        out[o + 2] = b
        out[o + 3] = 255
    return DecodedSprite(item.width, item.height, item.nx, item.ny, "raw", bytes(out), None, ())


def _decode_rle(item: BitmapItem, palette: Palette) -> DecodedSprite:
    """Decode a run-length-encoded bitmap (type 2).

    Each line alternates an opaque run (a count byte then that many paletted pixels) with
    a transparent run (a count byte only); a ``0xFF`` in the count slot ends the line.
    """
    if item.width == 0 or item.height == 0:
        return _empty_sprite(item, "rle")
    colors = palette.colors
    width, height, block = item.width, item.height, item.payload
    offsets = _line_offsets(block, height)
    out = bytearray(width * height * 4)
    for y in range(height):
        p = offsets[y]
        row = y * width * 4
        x = 0
        opaque = True
        while True:
            count = block[p]
            p += 1
            if count == _LINE_END:
                break
            if opaque:
                for _ in range(count):
                    if x >= width:
                        break
                    r, g, b = colors[block[p]]
                    p += 1
                    o = row + x * 4
                    out[o] = r
                    out[o + 1] = g
                    out[o + 2] = b
                    out[o + 3] = 255
                    x += 1
            else:
                x += count
            opaque = not opaque
    return DecodedSprite(width, height, item.nx, item.ny, "rle", bytes(out), None, ())


def _decode_player(item: BitmapItem, palette: Palette) -> DecodedSprite:
    """Decode a player-color bitmap (type 4).

    Opcodes (command byte ``c``): ``c < 0x40`` transparent run of ``c``; ``0x40-0x7F``
    copy ``c-0x40`` paletted pixels; ``0x80-0xBF`` a run of ``c-0x80`` player-color pixels
    sharing one following shade byte (0-3); ``0xC0-0xFF`` a run of ``c-0xC0`` pixels of one
    following paletted color. Player-color pixels are rendered in the default-player ramp
    and recorded in a shade mask.
    """
    if item.width == 0 or item.height == 0:
        return _empty_sprite(item, "player")
    colors = palette.colors
    width, height, block = item.width, item.height, item.payload
    offsets = _line_offsets(block, height)
    out = bytearray(width * height * 4)
    mask = bytearray(width * height)
    has_player = False
    for y in range(height):
        p = offsets[y]
        row = y * width
        x = 0
        while x < width:
            cmd = block[p]
            p += 1
            if cmd < 0x40:
                x += cmd
            elif cmd < 0x80:
                for _ in range(cmd - 0x40):
                    if x >= width:
                        break
                    _put(out, (row + x) * 4, colors[block[p]])
                    p += 1
                    x += 1
            elif cmd < 0xC0:
                shade = block[p]
                p += 1
                has_player = True
                color = colors[PLAYER_COLOR_BASE + shade]
                for _ in range(cmd - 0x80):
                    if x >= width:
                        break
                    _put(out, (row + x) * 4, color)
                    mask[row + x] = shade + 1
                    x += 1
            else:
                color = colors[block[p]]
                p += 1
                for _ in range(cmd - 0xC0):
                    if x >= width:
                        break
                    _put(out, (row + x) * 4, color)
                    x += 1
    if not has_player:
        return DecodedSprite(width, height, item.nx, item.ny, "player", bytes(out), None, ())
    indices = tuple(PLAYER_COLOR_BASE + s for s in range(PLAYER_COLOR_COUNT))
    return DecodedSprite(width, height, item.nx, item.ny, "player", bytes(out), bytes(mask), indices)


def _decode_shadow(item: BitmapItem) -> DecodedSprite:
    """Decode a monochrome shadow bitmap (type 7) as semi-transparent black pixels.

    Each line alternates a transparent run with a shadow run (counts only, no pixel data);
    a ``0xFF`` in the count slot ends the line.
    """
    if item.width == 0 or item.height == 0:
        return _empty_sprite(item, "shadow")
    width, height, block = item.width, item.height, item.payload
    offsets = _line_offsets(block, height)
    out = bytearray(width * height * 4)
    for y in range(height):
        p = offsets[y]
        row = y * width * 4
        x = 0
        shadow = False
        while True:
            count = block[p]
            p += 1
            if count == _LINE_END:
                break
            if shadow:
                for _ in range(count):
                    if x >= width:
                        break
                    out[row + x * 4 + 3] = SHADOW_ALPHA
                    x += 1
            else:
                x += count
            shadow = not shadow
    return DecodedSprite(width, height, item.nx, item.ny, "shadow", bytes(out), None, ())


def _put(out: bytearray, offset: int, color: tuple[int, int, int]) -> None:
    """Write an opaque RGB color at ``offset`` in an RGBA buffer."""
    out[offset] = color[0]
    out[offset + 1] = color[1]
    out[offset + 2] = color[2]
    out[offset + 3] = 255
