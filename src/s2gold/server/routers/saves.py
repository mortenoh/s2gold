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


@router.get("")
async def list_saves(request: Request) -> list[SaveMeta]:
    """List all saves, newest first."""
    return _store(request).list()


@router.get("/{save_id}")
async def get_save(request: Request, save_id: SaveId) -> SaveGame:
    """Fetch one save including its engine state."""
    save = _store(request).get(save_id)
    if save is None:
        raise HTTPException(status_code=404, detail=f"save {save_id!r} not found")
    return save


@router.put("/{save_id}")
async def put_save(request: Request, save_id: SaveId, payload: SavePayload) -> SaveGame:
    """Create or overwrite a save."""
    return _store(request).put(save_id, payload)


@router.delete("/{save_id}", status_code=204)
async def delete_save(request: Request, save_id: SaveId) -> None:
    """Delete a save."""
    if not _store(request).delete(save_id):
        raise HTTPException(status_code=404, detail=f"save {save_id!r} not found")
