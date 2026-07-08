"""LST container walker for The Settlers II archives.

An LST file is a little-endian container: a ``u16`` magic (``0x4E20``) followed by a
``u32`` item count. Each slot begins with an ``s16`` "used" flag (only ``1`` means the
slot holds an item) and, when used, an ``s16`` bob-type discriminator followed by a
type-specific payload with no stored length. The walker fully parses every item so it can
advance to the next slot, and raises loudly (with byte offset and item index) on any type
it does not know how to consume.

Layouts follow the settlers2.net LST documentation, cross-checked against this machine's
real game data (the documented ``0x4320`` magic is ``0x4E20`` in practice).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from s2gold.formats.binio import Reader
from s2gold.formats.palette import Palette

LST_MAGIC = 0x4E20

# Bob-type discriminators.
BOB_SOUND = 1
BOB_BITMAP_RLE = 2
BOB_FONT = 3
BOB_BITMAP_PLAYER = 4
BOB_PALETTE = 5
BOB_BOB = 6
BOB_BITMAP_SHADOW = 7
BOB_BITMAP_RAW = 14

# Kinds emitted for bitmap items, keyed by bob-type.
_BITMAP_KINDS = {
    BOB_BITMAP_RLE: "rle",
    BOB_BITMAP_PLAYER: "player",
    BOB_BITMAP_SHADOW: "shadow",
    BOB_BITMAP_RAW: "raw",
}


@dataclass(frozen=True)
class SoundItem:
    """A raw sound payload (unsigned 8-bit PCM at 11025 Hz, or XMIDI for item 0)."""

    index: int
    data: bytes


@dataclass(frozen=True)
class PaletteItem:
    """An embedded 256-color palette."""

    index: int
    palette: Palette


@dataclass(frozen=True)
class BitmapItem:
    """An undecoded bitmap item; decode with :mod:`s2gold.formats.bitmaps`.

    Attributes:
        index: Slot index within the archive.
        bobtype: Original bob-type (2 RLE, 4 player, 7 shadow, 14 raw).
        kind: Human-readable decoder kind ("rle", "player", "shadow", "raw").
        nx: Anchor/hotspot X (the sprite's zero point).
        ny: Anchor/hotspot Y.
        width: Sprite width in pixels.
        height: Sprite height in pixels.
        payload: For 2/4/7 the ``length``-byte block of line offsets plus compressed
            rows; for 14 the raw ``width * height`` paletted pixel bytes.
    """

    index: int
    bobtype: int
    kind: str
    nx: int
    ny: int
    width: int
    height: int
    payload: bytes


@dataclass(frozen=True)
class FontItem:
    """A font: horizontal/vertical spacing plus per-glyph bitmaps.

    Fonts do not occur in any graphics LST shipped with the game (they live in the
    IDX/DAT resource archive), so this branch is parsed defensively per the documented
    structure and is not exercised by the real data.
    """

    index: int
    dx: int
    dy: int
    glyphs: list[BitmapItem] = field(default_factory=list)


@dataclass(frozen=True)
class BobItem:
    """A raw, unparsed BOB payload placeholder (never seen inside real LSTs)."""

    index: int


Item = SoundItem | PaletteItem | BitmapItem | FontItem | BobItem


class LstError(ValueError):
    """Raised when an LST cannot be parsed (bad magic or unknown item type)."""


def _read_bitmap_header(r: Reader) -> tuple[int, int, int, int, bytes]:
    """Read a compressed-bitmap header (types 2/4/7) and its ``length``-byte block.

    Returns:
        A tuple ``(nx, ny, width, height, block)``.
    """
    nx = r.s16()
    ny = r.s16()
    r.u32()  # reserved, always zero
    width = r.u16()
    height = r.u16()
    r.u16()  # palette id, always 0x0001
    length = r.u32()
    block = r.bytes(length)
    return nx, ny, width, height, block


def _read_raw_bitmap(r: Reader) -> tuple[int, int, int, int, bytes]:
    """Read an uncompressed bitmap (type 14): header, pixels, then a trailing footer.

    Layout: ``u16`` palette id, ``u32`` data length, ``length`` paletted pixel bytes,
    then a 16-byte footer (``s16 nx, s16 ny, u16 width, u16 height`` plus 8 reserved).
    """
    r.u16()  # palette id
    length = r.u32()
    pixels = r.bytes(length)
    nx = r.s16()
    ny = r.s16()
    width = r.u16()
    height = r.u16()
    r.bytes(8)  # reserved footer tail
    return nx, ny, width, height, pixels


def _read_font(r: Reader, index: int) -> FontItem:
    """Read a font item: ``u8`` dx, ``u8`` dy, then a run of nested glyph bitmaps.

    The documented layout is 224 glyph slots (characters 32-255), each a standard item
    header followed by a bitmap payload. Not exercised by shipped graphics archives.
    """
    dx = r.u8()
    dy = r.u8()
    glyphs: list[BitmapItem] = []
    for glyph_index in range(224):
        used = r.s16()
        if used != 1:
            continue
        bobtype = r.s16()
        if bobtype in (BOB_BITMAP_RLE, BOB_BITMAP_PLAYER, BOB_BITMAP_SHADOW):
            nx, ny, width, height, block = _read_bitmap_header(r)
            glyphs.append(BitmapItem(glyph_index, bobtype, _BITMAP_KINDS[bobtype], nx, ny, width, height, block))
        elif bobtype == BOB_BITMAP_RAW:
            nx, ny, width, height, pixels = _read_raw_bitmap(r)
            glyphs.append(BitmapItem(glyph_index, bobtype, "raw", nx, ny, width, height, pixels))
        else:
            raise LstError(f"font glyph {glyph_index}: unsupported glyph bob-type {bobtype}")
    return FontItem(index, dx, dy, glyphs)


def read_lst(data: bytes) -> list[Item]:
    """Parse an LST container into its list of items (unused slots are skipped).

    Args:
        data: The full LST file contents.

    Returns:
        The parsed items in archive order; each item keeps its original slot ``index``.

    Raises:
        LstError: On a bad magic number or an item type the walker cannot consume.
    """
    r = Reader(data)
    magic = r.u16()
    if magic != LST_MAGIC:
        raise LstError(f"not an LST file (magic 0x{magic:04X}, expected 0x{LST_MAGIC:04X})")
    count = r.u32()
    items: list[Item] = []
    for index in range(count):
        used = r.s16()
        if used != 1:
            continue
        item_offset = r.pos
        bobtype = r.s16()
        try:
            item = _parse_item(r, index, bobtype)
        except LstError:
            raise
        except (EOFError, ValueError) as exc:
            raise LstError(f"item {index} (bob-type {bobtype}) at offset {item_offset}: {exc}") from exc
        items.append(item)
    return items


def _parse_item(r: Reader, index: int, bobtype: int) -> Item:
    """Parse a single item's payload for a known bob-type."""
    if bobtype == BOB_SOUND:
        length = r.u32()
        return SoundItem(index, r.bytes(length))
    if bobtype in (BOB_BITMAP_RLE, BOB_BITMAP_PLAYER, BOB_BITMAP_SHADOW):
        nx, ny, width, height, block = _read_bitmap_header(r)
        return BitmapItem(index, bobtype, _BITMAP_KINDS[bobtype], nx, ny, width, height, block)
    if bobtype == BOB_BITMAP_RAW:
        nx, ny, width, height, pixels = _read_raw_bitmap(r)
        return BitmapItem(index, bobtype, "raw", nx, ny, width, height, pixels)
    if bobtype == BOB_PALETTE:
        return PaletteItem(index, Palette.from_lst_item(r))
    if bobtype == BOB_FONT:
        return _read_font(r, index)
    if bobtype == BOB_BOB:
        raise LstError(
            f"item {index}: bob-type 6 (BOB) has no stored length and does not occur in "
            f"graphics LSTs; parsing it is out of scope for this walker (offset {r.pos})"
        )
    raise LstError(f"item {index}: unknown bob-type {bobtype} at offset {r.pos}")
