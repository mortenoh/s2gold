"""Reader for the IDX/DAT archive pair used by The Settlers II resource files.

An archive is a pair of files: a small ``*.IDX`` directory and a large ``*.DAT`` blob
(for example ``DATA/RESOURCE.IDX`` + ``DATA/RESOURCE.DAT``, ``DATA/IO/IO.IDX`` +
``DATA/IO/IO.DAT``, and the editor's ``EDITIO`` / ``EDITRES`` pairs).

Layout (verified byte-exactly against this machine's real data, matching the settlers2.net
IDX/DAT documentation):

* **IDX**: a ``u32`` entry count, then one 28-byte record per entry:

  * 16 bytes: NUL-padded name (cp437).
  * ``u32``: offset of the item's data inside the DAT file.
  * 6 bytes: unknown (usually zero, but not always — ignored).
  * ``s16``: bob-type, the same discriminator used by LST items.

* **DAT**: a flat blob. At each entry's offset the item is stored exactly like an LST
  item's body: a leading ``s16`` bob-type (repeating the IDX bob-type) followed by the
  type-specific payload. Parsing therefore reuses :func:`s2gold.formats.lst.read_item_at`.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from s2gold.formats import lst
from s2gold.formats.binio import Reader
from s2gold.formats.lst import Item

_IDX_ENTRY_SIZE = 28
_NAME_SIZE = 16


class DatidxError(ValueError):
    """Raised when an IDX/DAT archive cannot be parsed."""


@dataclass(frozen=True)
class IdxEntry:
    """One IDX directory record.

    Attributes:
        name: The entry's name (cp437, trailing NULs stripped).
        offset: Byte offset of the item inside the DAT file.
        bobtype: The item's bob-type discriminator (see :mod:`s2gold.formats.lst`).
    """

    name: str
    offset: int
    bobtype: int


@dataclass(frozen=True)
class DatArchive:
    """A parsed IDX/DAT archive: its directory plus the parsed item per entry.

    Attributes:
        entries: The IDX directory records, in file order.
        items: The parsed DAT item for each entry, parallel to :attr:`entries`.
    """

    entries: tuple[IdxEntry, ...]
    items: tuple[Item, ...]


def read_idx(data: bytes) -> list[IdxEntry]:
    """Parse an IDX directory into its list of entries.

    Args:
        data: The full IDX file contents.

    Returns:
        The directory entries in file order.

    Raises:
        DatidxError: If the file is truncated or its entry count is inconsistent.
    """
    r = Reader(data)
    try:
        count = r.u32()
    except EOFError as exc:
        raise DatidxError(f"IDX too small for header: {exc}") from exc
    expected = 4 + count * _IDX_ENTRY_SIZE
    if len(data) < expected:
        raise DatidxError(f"IDX declares {count} entries ({expected} bytes) but file is {len(data)} bytes")
    entries: list[IdxEntry] = []
    for _ in range(count):
        name = r.cstr(_NAME_SIZE)
        offset = r.u32()
        r.bytes(6)  # unknown, ignored
        bobtype = r.s16()
        entries.append(IdxEntry(name, offset, bobtype))
    return entries


def read_archive(idx_path: Path, dat_path: Path) -> DatArchive:
    """Read and fully parse an IDX/DAT archive pair.

    Args:
        idx_path: Path to the ``*.IDX`` directory file.
        dat_path: Path to the matching ``*.DAT`` data file.

    Returns:
        The parsed archive.

    Raises:
        DatidxError: On any structural problem in the IDX or DAT.
    """
    entries = read_idx(idx_path.read_bytes())
    dat = dat_path.read_bytes()
    items: list[Item] = []
    for index, entry in enumerate(entries):
        if entry.offset > len(dat):
            raise DatidxError(f"entry {index} ({entry.name!r}) offset {entry.offset} exceeds DAT size {len(dat)}")
        r = Reader(dat, entry.offset)
        try:
            item = lst.read_item_at(r, index)
        except lst.LstError as exc:
            raise DatidxError(f"entry {index} ({entry.name!r}): {exc}") from exc
        items.append(item)
    return DatArchive(tuple(entries), tuple(items))
