"""LBM/BBM image decoding for The Settlers II texture files.

Settlers II ships its texture tilesets as IFF ``FORM``/``PBM `` images (Deluxe
Paint "chunky" 8-bit LBMs), not the planar ``ILBM`` variant. Each file carries a
``BMHD`` header, an optional ``CMAP`` palette, and a ``BODY`` chunk that is either
raw or PackBits-compressed (per the ``BMHD`` compression flag).

Format reference: https://settlers2.net/documentation/graphics-files-lbm/
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

from s2gold.formats.iff import read_form, unpack_bits
from s2gold.formats.palette import Palette


@dataclass(frozen=True)
class LbmImage:
    """A decoded 8-bit indexed LBM image.

    Attributes:
        width: Image width in pixels.
        height: Image height in pixels.
        pixels: Row-major palette indices, one byte per pixel (``width * height``).
        palette: The embedded ``CMAP`` palette, or ``None`` when the file has none.
    """

    width: int
    height: int
    pixels: bytes
    palette: Palette | None


def decode_lbm(data: bytes) -> LbmImage:
    """Decode an IFF ``PBM `` (chunky 8-bit) LBM/BBM image.

    Args:
        data: Raw bytes of the ``.LBM``/``.BBM`` file.

    Returns:
        The decoded image with palette indices and any embedded palette.

    Raises:
        ValueError: When the FORM type is not ``PBM `` or a required chunk is
            missing.
    """
    form_type, chunks = read_form(data)
    if form_type != b"PBM ":
        raise ValueError(f"unsupported LBM form type {form_type!r} (only chunky 'PBM ' is supported)")
    if b"BMHD" not in chunks:
        raise ValueError("LBM is missing its BMHD header chunk")
    if b"BODY" not in chunks:
        raise ValueError("LBM is missing its BODY chunk")

    bmhd = chunks[b"BMHD"]
    # BMHD is big-endian: width u16, height u16, x s16, y s16, planes u8, masking u8,
    # compression u8, pad u8, transparent u16, xaspect u8, yaspect u8, pagew s16, pageh s16.
    width, height = struct.unpack(">HH", bmhd[0:4])
    compression = bmhd[10]

    body = chunks[b"BODY"]
    expected = width * height
    if compression == 1:
        pixels = unpack_bits(body, expected)
    else:
        pixels = body[:expected]
    if len(pixels) != expected:
        raise ValueError(f"LBM body decoded to {len(pixels)} bytes, expected {expected}")

    palette = Palette.from_cmap(chunks[b"CMAP"]) if b"CMAP" in chunks else None
    return LbmImage(width=width, height=height, pixels=pixels, palette=palette)
