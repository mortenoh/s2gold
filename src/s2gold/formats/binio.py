"""Little-endian binary reader used by all Settlers II format parsers."""

from __future__ import annotations

import struct


class Reader:
    """Sequential little-endian reader over an immutable byte buffer."""

    def __init__(self, data: bytes, pos: int = 0) -> None:
        self.data = data
        self.pos = pos

    def eof(self) -> bool:
        """Return True when the cursor is at or past the end of the buffer."""
        return self.pos >= len(self.data)

    def remaining(self) -> int:
        """Return the number of unread bytes."""
        return max(0, len(self.data) - self.pos)

    def bytes(self, n: int) -> bytes:
        """Read exactly n raw bytes."""
        if self.pos + n > len(self.data):
            raise EOFError(f"read of {n} bytes at {self.pos} exceeds buffer of {len(self.data)}")
        out = self.data[self.pos : self.pos + n]
        self.pos += n
        return out

    def u8(self) -> int:
        """Read an unsigned 8-bit integer."""
        return self.bytes(1)[0]

    def u16(self) -> int:
        """Read an unsigned 16-bit little-endian integer."""
        return int(struct.unpack("<H", self.bytes(2))[0])

    def s16(self) -> int:
        """Read a signed 16-bit little-endian integer."""
        return int(struct.unpack("<h", self.bytes(2))[0])

    def u32(self) -> int:
        """Read an unsigned 32-bit little-endian integer."""
        return int(struct.unpack("<I", self.bytes(4))[0])

    def s32(self) -> int:
        """Read a signed 32-bit little-endian integer."""
        return int(struct.unpack("<i", self.bytes(4))[0])

    def cstr(self, n: int, encoding: str = "cp437") -> str:
        """Read a fixed-size, NUL-padded string field."""
        raw = self.bytes(n)
        return raw.split(b"\x00", 1)[0].decode(encoding, errors="replace")
