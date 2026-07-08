"""Decoder for BOB animation containers (``DATA/BOBS/*.BOB``).

BOB files hold the walking-figure animations for settlers and their carried goods
(``CARRIER.BOB``, ``CARRIER2.BOB``, ``JOBS.BOB``). The format is documented nowhere in
prose; the structure below was reverse-engineered as facts (magic numbers, block layout,
counts) from libsiedler2's ``ArchivItem_Bob``/``ArchivItem_Bitmap_Player`` and then
re-implemented independently, and it decodes every shipped BOB byte-exactly.

Wire layout (little-endian):

* ``u16`` file magic ``0x01F6``.
* **body color block**: ``u16`` header ``0x01F5``, ``u16`` size, then ``size`` pixel bytes.
  This is one shared command/pixel stream that all body sprites index into.
* **96 body sprites** (``NUM_BODY_IMAGES`` = 2 fat-types x 6 directions x 8 animation
  steps): each is ``u16`` header ``0x01F4``, ``u8`` height, ``height`` ``u16`` row-start
  offsets (absolute into the body color block), then ``u8`` y-offset. Every sprite is 32px
  wide with a fixed 16px x-anchor and is a player-color ("type 4") bitmap.
* **6 direction color blocks**: one shared pixel stream per direction, each a color block.
* ``u16`` overlay count, then that many overlay sprite descriptors (same shape as a body
  sprite: header, height, row starts, y-offset).
* ``u16`` link count, then that many links, each ``u16`` overlay-index + ``u16`` unused.
  Links form the array ``[job][animStep][fat][direction]`` (direction innermost); each maps
  an animation cell to the overlay sprite to draw over the matching body. An overlay's
  pixels come from the direction color block of the (first) link that references it.
"""

from __future__ import annotations

from dataclasses import dataclass

from s2gold.formats.binio import Reader
from s2gold.formats.bitmaps import PLAYER_COLOR_BASE, PLAYER_COLOR_COUNT, DecodedSprite, decode_player_rows
from s2gold.formats.palette import Palette

BOB_MAGIC = 0x01F6
COLOR_BLOCK_HEADER = 0x01F5
IMAGE_DATA_HEADER = 0x01F4

NUM_FAT_TYPES = 2
NUM_DIRECTIONS = 6
NUM_ANIM_STEPS = 8
NUM_BODY_IMAGES = NUM_FAT_TYPES * NUM_DIRECTIONS * NUM_ANIM_STEPS  # 96
NUM_LINKS_PER_JOB = NUM_ANIM_STEPS * NUM_FAT_TYPES * NUM_DIRECTIONS  # 96

SPRITE_WIDTH = 32
X_OFFSET = 16


class BobError(ValueError):
    """Raised when a BOB file cannot be parsed."""


@dataclass(frozen=True)
class Bob:
    """A decoded BOB container.

    Attributes:
        bodies: The 96 body sprites, indexed by :func:`body_index`.
        overlays: The overlay (carried-good/tool) sprites, indexed by a link value.
        links: One overlay index per animation cell, indexed by :func:`link_index`; every
            value is a valid index into :attr:`overlays`.
        num_jobs: ``len(links) / 96`` — the number of jobs/figures in this container.
    """

    bodies: tuple[DecodedSprite, ...]
    overlays: tuple[DecodedSprite, ...]
    links: tuple[int, ...]
    num_jobs: int


def body_index(fat: bool, direction: int, anim_step: int) -> int:
    """Return the :attr:`Bob.bodies` index for a body sprite: ``[fat][direction][step]``."""
    return (int(fat) * NUM_DIRECTIONS + direction) * NUM_ANIM_STEPS + anim_step


def link_index(job: int, anim_step: int, fat: bool, direction: int) -> int:
    """Return the :attr:`Bob.links` index for a cell: ``[job][step][fat][direction]``."""
    return ((job * NUM_ANIM_STEPS + anim_step) * NUM_FAT_TYPES + int(fat)) * NUM_DIRECTIONS + direction


def _read_color_block(r: Reader) -> bytes:
    """Read a color block: ``u16`` header ``0x01F5``, ``u16`` size, then ``size`` bytes."""
    header = r.u16()
    if header != COLOR_BLOCK_HEADER:
        raise BobError(f"expected color block header 0x{COLOR_BLOCK_HEADER:04X}, got 0x{header:04X} at {r.pos - 2}")
    size = r.u16()
    return r.bytes(size)


def _read_image_data(r: Reader) -> tuple[list[int], int]:
    """Read an image descriptor: header ``0x01F4``, ``u8`` height, row starts, ``u8`` ny.

    Returns:
        A tuple ``(row_starts, ny)`` where ``row_starts`` are absolute offsets into the
        relevant color block, one per row.
    """
    header = r.u16()
    if header != IMAGE_DATA_HEADER:
        raise BobError(f"expected image header 0x{IMAGE_DATA_HEADER:04X}, got 0x{header:04X} at {r.pos - 2}")
    height = r.u8()
    starts = [r.u16() for _ in range(height)]
    ny = r.u8()
    return starts, ny


def _sprite(pixels: bytes, starts: list[int], ny: int, palette: Palette) -> DecodedSprite:
    """Decode one BOB sprite (32px wide player-color bitmap) from a shared color block."""
    rgba, mask = decode_player_rows(pixels, starts, SPRITE_WIDTH, palette)
    height = len(starts)
    if mask is None:
        return DecodedSprite(SPRITE_WIDTH, height, X_OFFSET, ny, "player", rgba, None, ())
    indices = tuple(PLAYER_COLOR_BASE + s for s in range(PLAYER_COLOR_COUNT))
    return DecodedSprite(SPRITE_WIDTH, height, X_OFFSET, ny, "player", rgba, mask, indices)


def read_bob(data: bytes, palette: Palette) -> Bob:
    """Parse and decode a BOB container into RGBA sprites and its links table.

    Args:
        data: The full BOB file contents.
        palette: Palette resolving paletted indices (the standard PAL5).

    Returns:
        The decoded container.

    Raises:
        BobError: On a bad magic number, a bad block header, or an out-of-range link.
    """
    r = Reader(data)
    magic = r.u16()
    if magic != BOB_MAGIC:
        raise BobError(f"not a BOB file (magic 0x{magic:04X}, expected 0x{BOB_MAGIC:04X})")

    base = _read_color_block(r)
    bodies = [_sprite(base, *_read_image_data(r), palette) for _ in range(NUM_BODY_IMAGES)]

    direction_blocks = [_read_color_block(r) for _ in range(NUM_DIRECTIONS)]

    num_overlays = r.u16()
    overlay_desc = [_read_image_data(r) for _ in range(num_overlays)]

    num_links = r.u16()
    links: list[int] = []
    overlays: list[DecodedSprite | None] = [None] * num_overlays
    for i in range(num_links):
        link = r.u16()
        r.u16()  # unused
        if link >= num_overlays:
            raise BobError(f"link {i} references overlay {link} but only {num_overlays} exist")
        links.append(link)
        if overlays[link] is None:
            starts, ny = overlay_desc[link]
            overlays[link] = _sprite(direction_blocks[i % NUM_DIRECTIONS], starts, ny, palette)

    # Overlays never referenced by a link (none in shipped data) fall back to direction 0.
    for idx, sprite in enumerate(overlays):
        if sprite is None:
            starts, ny = overlay_desc[idx]
            overlays[idx] = _sprite(direction_blocks[0], starts, ny, palette)

    num_jobs = num_links // NUM_LINKS_PER_JOB
    return Bob(tuple(bodies), tuple(s for s in overlays if s is not None), tuple(links), num_jobs)
