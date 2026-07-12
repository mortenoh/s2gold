"""Disk-backed game-session store: one JSON file per session under the sessions directory."""

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path

from s2gold.server.models import (
    SAVE_ID_PATTERN,
    SessionCreate,
    SessionMeta,
    SessionRecord,
    SessionSnapshot,
    utcnow,
)

_ID_RE = re.compile(SAVE_ID_PATTERN)


class InvalidSessionId(ValueError):
    """Raised when a session id fails validation (also guards path traversal)."""


class SessionStore:
    """CRUD over JSON session files in a single directory."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, session_id: str) -> Path:
        if not _ID_RE.fullmatch(session_id):
            raise InvalidSessionId(f"invalid session id: {session_id!r}")
        return self.root / f"{session_id}.json"

    def _write(self, record: SessionRecord) -> None:
        path = self._path(record.id)
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(record.model_dump_json())
        tmp.replace(path)

    def create(self, payload: SessionCreate) -> SessionRecord:
        """Create a new session with a server-generated id."""
        # uuid4().hex is 32 lowercase hex chars, which satisfies SAVE_ID_PATTERN.
        # These ids are server bookkeeping, not gameplay, so randomness is fine.
        now = utcnow()
        record = SessionRecord(
            id=uuid.uuid4().hex,
            map=payload.map,
            ai=payload.ai,
            campaign=payload.campaign,
            tick=0,
            data=None,
            created_at=now,
            updated_at=now,
        )
        self._write(record)
        return record

    def list(self) -> list[SessionMeta]:
        """Return metadata for all sessions, newest updated first (data omitted)."""
        metas: list[SessionMeta] = []
        if not self.root.is_dir():
            return metas
        for path in sorted(self.root.glob("*.json")):
            try:
                raw = json.loads(path.read_text())
                metas.append(SessionMeta.model_validate(raw))
            except (ValueError, OSError):
                continue  # skip corrupt entries rather than failing the listing
        metas.sort(key=lambda m: m.updated_at, reverse=True)
        return metas

    def get(self, session_id: str) -> SessionRecord | None:
        """Load one session, or None when absent."""
        path = self._path(session_id)
        if not path.is_file():
            return None
        return SessionRecord.model_validate(json.loads(path.read_text()))

    def snapshot(self, session_id: str, snap: SessionSnapshot) -> SessionRecord | None:
        """Apply a world snapshot in place, or None when the session is absent."""
        path = self._path(session_id)
        if not path.is_file():
            return None
        current = SessionRecord.model_validate(json.loads(path.read_text()))
        record = SessionRecord(
            id=current.id,
            map=current.map,
            ai=current.ai,
            campaign=current.campaign,
            tick=snap.tick,
            data=snap.data,
            created_at=current.created_at,
            updated_at=utcnow(),
        )
        self._write(record)
        return record

    def delete(self, session_id: str) -> bool:
        """Delete a session; returns False when it did not exist."""
        path = self._path(session_id)
        if not path.is_file():
            return False
        path.unlink()
        return True
