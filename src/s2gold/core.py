"""Shared pipeline conventions: directory layout, tool checks, and the output manifest."""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
EXTRACTED_DIR = REPO_ROOT / "extracted"
ASSETS_DIR = REPO_ROOT / "packages" / "app" / "public" / "assets"

REQUIRED_TOOLS = ("innoextract",)
OPTIONAL_TOOLS = ("fluidsynth", "ffmpeg")

MANIFEST_VERSION = 1


@dataclass
class Manifest:
    """Index of converted assets, written to <assets>/manifest.json for the app to load."""

    version: int = MANIFEST_VERSION
    categories: dict[str, dict[str, object]] = field(default_factory=dict)

    def add(self, category: str, payload: dict[str, object]) -> None:
        """Record a converted category (e.g. "terrain", "sfx") and its file index."""
        self.categories[category] = payload

    def save(self, assets_dir: Path = ASSETS_DIR) -> Path:
        """Merge with any existing manifest on disk and write it back."""
        path = assets_dir / "manifest.json"
        merged = self.categories
        if path.exists():
            existing = json.loads(path.read_text())
            merged = {**existing.get("categories", {}), **self.categories}
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"version": self.version, "categories": merged}, indent=1))
        return path


def find_tool(name: str) -> str | None:
    """Return the resolved path of an external tool, or None when missing."""
    return shutil.which(name)


def run_tool(args: list[str]) -> subprocess.CompletedProcess[bytes]:
    """Run an external tool, raising on non-zero exit."""
    return subprocess.run(args, check=True, capture_output=True)


def write_json(path: Path, payload: object) -> None:
    """Write compact JSON, creating parent directories."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, separators=(",", ":")))
