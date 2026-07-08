"""Convert GER/ENG/RTX game-text files into JSON string arrays.

Outputs ``<assets>/texts/<lang>/<name>.json`` (arrays of strings, ``null`` for
missing container slots) plus a ``texts/index.json`` catalog. Language comes from
the file extension: ``.ENG`` -> ``eng``, ``.GER`` -> ``ger``. Per-mission ``.RTX``
scripts are grouped under ``mission``. Files sharing a basename across ``TXT``
subdirectories are disambiguated with a directory prefix.
"""

from __future__ import annotations

import json
from pathlib import Path

from s2gold.core import Manifest
from s2gold.formats.gametext import parse_text

# Container text directories: (subdir, name prefix).
_TXT_DIRS: tuple[tuple[str, str], ...] = (
    ("DATA/TXT", "txt"),
    ("DATA/TXT2", "txt2"),
    ("DATA/TXT3", "txt3"),
)

_EXT_TO_LANG = {".eng": "eng", ".ger": "ger"}


def _write_entries(out_dir: Path, lang: str, name: str, entries: list[str | None]) -> dict[str, object]:
    """Write one text file's entries and return its index record."""
    lang_dir = out_dir / lang
    lang_dir.mkdir(parents=True, exist_ok=True)
    (lang_dir / f"{name}.json").write_text(json.dumps(entries, ensure_ascii=False, separators=(",", ":")))
    return {"file": f"texts/{lang}/{name}.json", "name": name, "count": len(entries)}


def run(extracted: Path, assets: Path) -> None:
    """Convert every ENG/GER text container and RTX mission script."""
    out_dir = assets / "texts"
    out_dir.mkdir(parents=True, exist_ok=True)

    index: dict[str, list[dict[str, object]]] = {}

    for subdir, prefix in _TXT_DIRS:
        src_dir = extracted / subdir
        if not src_dir.is_dir():
            continue
        for src in sorted(src_dir.iterdir()):
            lang = _EXT_TO_LANG.get(src.suffix.lower())
            if lang is None:
                continue
            entries = parse_text(src.read_bytes())
            name = f"{prefix}_{src.stem.lower()}"
            index.setdefault(lang, []).append(_write_entries(out_dir, lang, name, entries))

    missions_dir = extracted / "DATA" / "MISSIONS"
    if missions_dir.is_dir():
        for src in sorted(missions_dir.glob("*.RTX")):
            entries = parse_text(src.read_bytes())
            index.setdefault("mission", []).append(_write_entries(out_dir, "mission", src.stem.lower(), entries))

    (out_dir / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))

    manifest = Manifest()
    manifest.add("texts", {"index": "texts/index.json", "languages": sorted(index)})
    manifest.save(assets)
