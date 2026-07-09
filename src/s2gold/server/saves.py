"""Disk-backed save-game store: one JSON file per save under the saves directory."""

from __future__ import annotations

import json
import re
from pathlib import Path

from s2gold.server.models import SAVE_ID_PATTERN, SaveGame, SaveMeta, SavePayload, utcnow

_ID_RE = re.compile(SAVE_ID_PATTERN)


class InvalidSaveId(ValueError):
    """Raised when a save id fails validation (also guards path traversal)."""


class SaveStore:
    """CRUD over JSON save files in a single directory."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, save_id: str) -> Path:
        if not _ID_RE.fullmatch(save_id):
            raise InvalidSaveId(f"invalid save id: {save_id!r}")
        return self.root / f"{save_id}.json"

    def list(self) -> list[SaveMeta]:
        """Return metadata for all saves, newest updated first."""
        metas: list[SaveMeta] = []
        if not self.root.is_dir():
            return metas
        for path in sorted(self.root.glob("*.json")):
            try:
                raw = json.loads(path.read_text())
                metas.append(SaveMeta.model_validate(raw))
            except (ValueError, OSError):
                continue  # skip corrupt entries rather than failing the listing
        metas.sort(key=lambda m: m.updated_at, reverse=True)
        return metas

    def get(self, save_id: str) -> SaveGame | None:
        """Load one save, or None when absent."""
        path = self._path(save_id)
        if not path.is_file():
            return None
        return SaveGame.model_validate(json.loads(path.read_text()))

    def put(self, save_id: str, payload: SavePayload) -> SaveGame:
        """Create or overwrite a save, preserving created_at on overwrite."""
        path = self._path(save_id)
        now = utcnow()
        created_at = now
        if path.is_file():
            try:
                created_at = SaveMeta.model_validate(json.loads(path.read_text())).created_at
            except (ValueError, OSError):
                pass
        save = SaveGame(
            id=save_id,
            name=payload.name,
            map=payload.map,
            tick=payload.tick,
            data=payload.data,
            created_at=created_at,
            updated_at=now,
        )
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(save.model_dump_json())
        tmp.replace(path)
        return save

    def delete(self, save_id: str) -> bool:
        """Delete a save; returns False when it did not exist."""
        path = self._path(save_id)
        if not path.is_file():
            return False
        path.unlink()
        return True
