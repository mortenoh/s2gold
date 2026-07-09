"""Converter registry.

Each converter module exposes `run(extracted: Path, assets: Path) -> None` and is listed
in CONVERTERS in dependency order. Modules land incrementally; missing ones are skipped
with a notice so `install` stays usable throughout development.
"""

from __future__ import annotations

import importlib
from pathlib import Path
from typing import Protocol


class Converter(Protocol):
    """A converter module's entry point."""

    def run(self, extracted: Path, assets: Path) -> None:  # noqa: D102
        ...


CONVERTERS = (
    "palettes",
    "terrain",
    "graphics",
    "ui",
    "bobs",
    "fonts",
    "maps",
    "texts",
    "audio",
    "video",
)


def run_all(extracted: Path, assets: Path) -> None:
    """Run every registered converter in order, skipping modules that don't exist yet."""
    assets.mkdir(parents=True, exist_ok=True)
    for name in CONVERTERS:
        try:
            mod = importlib.import_module(f"s2gold.convert.{name}")
        except ModuleNotFoundError:
            print(f"[skip] converter '{name}' not implemented yet")
            continue
        print(f"[run ] {name}")
        mod.run(extracted, assets)
