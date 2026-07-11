"""Save-game CRUD endpoints backed by the disk SaveStore."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Request

from s2gold.server.models import SAVE_ID_PATTERN, SaveGame, SaveMeta, SavePayload
from s2gold.server.saves import SaveStore

router = APIRouter(prefix="/api/saves", tags=["saves"])

SaveId = Annotated[str, Path(pattern=SAVE_ID_PATTERN)]


def _store(request: Request) -> SaveStore:
    store: SaveStore = request.app.state.save_store
    return store


def _check_size(request: Request) -> None:
    """Reject oversized save uploads before buffering/parsing the body."""
    limit: int = request.app.state.settings.max_save_bytes
    length = request.headers.get("content-length")
    if length is not None and length.isdigit() and int(length) > limit:
        raise HTTPException(status_code=413, detail=f"save exceeds {limit} bytes")


# Handlers are deliberately sync (`def`): FastAPI runs them in a threadpool, so
# the disk reads/writes and JSON parsing never block the event loop.


@router.get("")
def list_saves(request: Request) -> list[SaveMeta]:
    """List all saves, newest first."""
    return _store(request).list()


@router.get("/{save_id}")
def get_save(request: Request, save_id: SaveId) -> SaveGame:
    """Fetch one save including its engine state."""
    save = _store(request).get(save_id)
    if save is None:
        raise HTTPException(status_code=404, detail=f"save {save_id!r} not found")
    return save


@router.put("/{save_id}")
def put_save(request: Request, save_id: SaveId, payload: SavePayload) -> SaveGame:
    """Create or overwrite a save."""
    _check_size(request)
    return _store(request).put(save_id, payload)


@router.delete("/{save_id}", status_code=204)
def delete_save(request: Request, save_id: SaveId) -> None:
    """Delete a save."""
    if not _store(request).delete(save_id):
        raise HTTPException(status_code=404, detail=f"save {save_id!r} not found")
