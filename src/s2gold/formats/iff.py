"""Minimal IFF (EA 85) chunk reader for LBM/BBM files (big-endian, even-padded chunks)."""

from __future__ import annotations

import struct


def read_form(data: bytes) -> tuple[bytes, dict[bytes, bytes]]:
    """Parse an IFF FORM file into (form_type, {chunk_id: payload}).

    Later duplicate chunk ids overwrite earlier ones; Settlers II files do not
    repeat chunk ids in practice.
    """
    if data[0:4] != b"FORM":
        raise ValueError(f"not an IFF FORM file (magic {data[0:4]!r})")
    form_type = data[8:12]
    pos = 12
    chunks: dict[bytes, bytes] = {}
    while pos + 8 <= len(data):
        cid = data[pos : pos + 4]
        clen = struct.unpack(">I", data[pos + 4 : pos + 8])[0]
        chunks[cid] = data[pos + 8 : pos + 8 + clen]
        pos += 8 + clen + (clen & 1)
    return form_type, chunks


def unpack_bits(src: bytes, expected: int) -> bytes:
    """Decompress ILBM PackBits RLE to exactly `expected` bytes (truncates any overrun)."""
    out = bytearray()
    i = 0
    while len(out) < expected and i < len(src):
        n = src[i]
        i += 1
        if n < 128:
            out += src[i : i + n + 1]
            i += n + 1
        elif n > 128:
            out += bytes([src[i]]) * (257 - n)
            i += 1
        # n == 128: no-op per the PackBits spec
    return bytes(out[:expected])
