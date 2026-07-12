"""Game-session CRUD endpoints backed by the disk SessionStore."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Request

from s2gold.server.models import (
    SAVE_ID_PATTERN,
    SessionCreate,
    SessionMeta,
    SessionRecord,
    SessionSnapshot,
)
from s2gold.server.sessions import SessionStore

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

SessionId = Annotated[str, Path(pattern=SAVE_ID_PATTERN)]


def _store(request: Request) -> SessionStore:
    store: SessionStore = request.app.state.session_store
    return store


def _check_size(request: Request) -> None:
    """Reject oversized snapshot uploads before buffering/parsing the body."""
    limit: int = request.app.state.settings.max_save_bytes
    length = request.headers.get("content-length")
    if length is not None and length.isdigit() and int(length) > limit:
        raise HTTPException(status_code=413, detail=f"snapshot exceeds {limit} bytes")


# Handlers are deliberately sync (`def`): FastAPI runs them in a threadpool, so
# the disk reads/writes and JSON parsing never block the event loop.


@router.post("")
def create_session(request: Request, payload: SessionCreate) -> SessionRecord:
    """Create a new server-side game session."""
    return _store(request).create(payload)


@router.get("")
def list_sessions(request: Request) -> list[SessionMeta]:
    """List all sessions, newest first."""
    return _store(request).list()


@router.get("/{session_id}")
def get_session(request: Request, session_id: SessionId) -> SessionRecord:
    """Fetch one session including its serialized world."""
    session = _store(request).get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"session {session_id!r} not found")
    return session


@router.put("/{session_id}")
def put_session(request: Request, session_id: SessionId, snap: SessionSnapshot) -> SessionRecord:
    """Apply a world snapshot to an existing session."""
    _check_size(request)
    session = _store(request).snapshot(session_id, snap)
    if session is None:
        raise HTTPException(status_code=404, detail=f"session {session_id!r} not found")
    return session


@router.delete("/{session_id}", status_code=204)
def delete_session(request: Request, session_id: SessionId) -> None:
    """Delete a session."""
    if not _store(request).delete(session_id):
        raise HTTPException(status_code=404, detail=f"session {session_id!r} not found")
