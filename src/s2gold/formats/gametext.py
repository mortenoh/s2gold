"""GER/ENG/RTX game-text container parser for The Settlers II.

Implemented from https://settlers2.net/documentation/ (text file format) and
verified against the real ``DATA/TXT*/*.ENG`` files.

Two shapes exist:

* **Text containers** start with the u16 magic ``0xFDE7`` (bytes ``E7 FD``)
  followed by ``count`` (u16), an unused/version u16, a ``size`` u32, and then
  ``count`` u32 offsets. Each offset is relative to the start of the offset table
  (i.e. absolute position ``10 + offset``); an offset of ``0`` marks a missing
  entry (``None``). Strings are NUL-terminated. ``size`` covers everything after
  the 10-byte header (offset table + string data).

* **Plain files** (e.g. credits and the ``.RTX`` mission scripts) do not carry
  the magic. They are decoded whole as a single raw text entry.

Encoding: the strings are DOS **code page 437**. Determined empirically -- the
German credit/name entries use bytes such as ``0x81`` (u-umlaut) and ``0x94``
(o-umlaut), which are valid CP437 glyphs but undefined in CP1252.
"""

from __future__ import annotations

from s2gold.formats.binio import Reader

MAGIC = 0xFDE7
ENCODING = "cp437"
_HEADER_SIZE = 10


def _decode(raw: bytes) -> str:
    """Decode a raw byte string using the game's CP437 encoding."""
    return raw.decode(ENCODING, errors="replace")


def is_container(data: bytes) -> bool:
    """Return True when the data begins with the 0xFDE7 text-container magic."""
    return len(data) >= 2 and data[0] == (MAGIC & 0xFF) and data[1] == (MAGIC >> 8)


def parse_text(data: bytes) -> list[str | None]:
    """Parse a GER/ENG/RTX text file into a list of strings.

    Container files yield one entry per offset-table slot, with ``None`` for
    empty slots. Plain (non-container) files yield a single-element list holding
    the whole decoded file.

    Args:
        data: Raw bytes of the text file.

    Returns:
        The decoded entries in order.
    """
    if not is_container(data):
        return [_decode(data)]

    r = Reader(data)
    r.u16()  # magic
    count = r.u16()
    r.u16()  # unused / version
    r.u32()  # size (bytes after the 10-byte header)

    offsets = [r.u32() for _ in range(count)]
    entries: list[str | None] = []
    for off in offsets:
        if off == 0:
            entries.append(None)
            continue
        start = _HEADER_SIZE + off
        end = data.find(b"\x00", start)
        if end == -1:
            end = len(data)
        entries.append(_decode(data[start:end]))
    return entries
