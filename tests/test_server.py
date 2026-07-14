"""Tests for the FastAPI server: health and save-game CRUD."""

from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from s2gold.server.app import create_app
from s2gold.server.config import Settings


@pytest.fixture
def app(tmp_path: Path) -> FastAPI:
    settings = Settings(
        saves_dir=tmp_path / "saves",
        sessions_dir=tmp_path / "sessions",
        assets_dir=tmp_path / "missing-assets",
        frontend_dist=tmp_path / "missing-dist",
    )
    return create_app(settings)


@pytest.fixture
async def client(app: FastAPI):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


async def test_health_check(client: AsyncClient):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_saves_crud_roundtrip(client: AsyncClient):
    assert (await client.get("/api/saves")).json() == []

    payload = {"name": "First game", "map": "maps_miss200", "tick": 1234, "data": {"world": [1, 2, 3]}}
    created = await client.put("/api/saves/first-game", json=payload)
    assert created.status_code == 200
    body = created.json()
    assert body["id"] == "first-game"
    assert body["tick"] == 1234
    assert body["created_at"] == body["updated_at"]

    listed = (await client.get("/api/saves")).json()
    assert [m["id"] for m in listed] == ["first-game"]
    assert "data" not in listed[0]

    fetched = (await client.get("/api/saves/first-game")).json()
    assert fetched["data"] == {"world": [1, 2, 3]}

    updated = await client.put(
        "/api/saves/first-game",
        json={**payload, "tick": 9999},
    )
    assert updated.json()["tick"] == 9999
    assert updated.json()["created_at"] == body["created_at"]
    assert updated.json()["updated_at"] != body["updated_at"]

    assert (await client.delete("/api/saves/first-game")).status_code == 204
    assert (await client.get("/api/saves/first-game")).status_code == 404
    assert (await client.delete("/api/saves/first-game")).status_code == 404


async def test_save_id_validation(client: AsyncClient):
    payload = {"name": "x", "map": "m", "data": {}}
    # NOTE: httpx normalizes dot segments client-side, so a literal "../" never
    # reaches the app; the encoded form below arrives raw and is decoded to
    # ".." by routing, genuinely exercising the SAVE_ID_PATTERN check.
    for bad in ("%2e%2e", "%2e%2e%2fetc%2fpasswd", "UPPER", "a b"):
        response = await client.put(f"/api/saves/{bad}", json=payload)
        assert response.status_code in (404, 422), bad


async def test_oversized_save_rejected(client: AsyncClient, app: FastAPI):
    app.state.settings.max_save_bytes = 1024
    big = {"name": "big", "map": "m", "data": {"blob": "x" * 4096}}
    response = await client.put("/api/saves/big-save", json=big)
    assert response.status_code == 413
    # Within the limit still works.
    response = await client.put("/api/saves/small-save", json={"name": "s", "map": "m", "data": {}})
    assert response.status_code == 200


async def test_blank_name_rejected(client: AsyncClient):
    response = await client.put("/api/saves/ok-id", json={"name": "   ", "map": "m", "data": {}})
    assert response.status_code == 422


async def test_sessions_crud_roundtrip(client: AsyncClient):
    assert (await client.get("/api/sessions")).json() == []

    created = await client.post(
        "/api/sessions",
        json={"map": "maps_miss200", "ai": [2, 3], "nations": ["rom", "rom", "vik"], "campaign": 5},
    )
    assert created.status_code == 200
    body = created.json()
    session_id = body["id"]
    assert session_id
    assert body["map"] == "maps_miss200"
    assert body["ai"] == [2, 3]
    assert body["nations"] == ["rom", "rom", "vik"]
    assert body["campaign"] == 5
    assert body["tick"] == 0
    assert body["data"] is None
    assert body["created_at"] == body["updated_at"]

    fetched = (await client.get(f"/api/sessions/{session_id}")).json()
    assert fetched["id"] == session_id
    assert fetched["data"] is None

    snap = await client.put(
        f"/api/sessions/{session_id}",
        json={"tick": 42, "data": {"world": [1, 2, 3]}},
    )
    assert snap.status_code == 200
    assert snap.json()["tick"] == 42
    assert snap.json()["created_at"] == body["created_at"]
    assert snap.json()["updated_at"] != body["updated_at"]

    after = (await client.get(f"/api/sessions/{session_id}")).json()
    assert after["tick"] == 42
    assert after["data"] == {"world": [1, 2, 3]}
    # Snapshot preserves the original session metadata.
    assert after["map"] == "maps_miss200"
    assert after["ai"] == [2, 3]
    assert after["nations"] == ["rom", "rom", "vik"]
    assert after["campaign"] == 5

    listed = (await client.get("/api/sessions")).json()
    assert [m["id"] for m in listed] == [session_id]
    assert "data" not in listed[0]

    assert (await client.delete(f"/api/sessions/{session_id}")).status_code == 204
    assert (await client.get(f"/api/sessions/{session_id}")).status_code == 404
    assert (await client.delete(f"/api/sessions/{session_id}")).status_code == 404


async def test_session_defaults(client: AsyncClient):
    created = await client.post("/api/sessions", json={"map": "m"})
    assert created.status_code == 200
    body = created.json()
    assert body["ai"] == []
    # Nations is optional and defaults to None (an all-Roman game), keeping
    # backward compatibility with clients that predate the field.
    assert body["nations"] is None
    assert body["campaign"] is None


async def test_legacy_session_without_nations_loads(client: AsyncClient, app: FastAPI):
    """A session file stored before the nations field existed still loads (nations=None)."""
    root: Path = app.state.session_store.root
    root.mkdir(parents=True, exist_ok=True)
    # A pre-nations record: no "nations" key at all.
    (root / "legacy1.json").write_text(
        '{"id": "legacy1", "map": "m", "ai": [1], "campaign": null, "tick": 3, '
        '"data": null, "created_at": "2020-01-01T00:00:00Z", '
        '"updated_at": "2020-01-01T00:00:00Z"}'
    )
    fetched = await client.get("/api/sessions/legacy1")
    assert fetched.status_code == 200
    body = fetched.json()
    assert body["ai"] == [1]
    assert body["nations"] is None


async def test_session_not_found(client: AsyncClient):
    assert (await client.get("/api/sessions/deadbeef")).status_code == 404
    snap = await client.put("/api/sessions/deadbeef", json={"tick": 1, "data": {}})
    assert snap.status_code == 404


async def test_oversized_snapshot_rejected(client: AsyncClient, app: FastAPI):
    created = await client.post("/api/sessions", json={"map": "m"})
    session_id = created.json()["id"]
    app.state.settings.max_save_bytes = 1024
    big = {"tick": 1, "data": {"blob": "x" * 4096}}
    response = await client.put(f"/api/sessions/{session_id}", json=big)
    assert response.status_code == 413
    # Within the limit still works.
    small = await client.put(f"/api/sessions/{session_id}", json={"tick": 2, "data": {}})
    assert small.status_code == 200


async def test_session_id_validation(client: AsyncClient):
    for bad in ("%2e%2e", "%2e%2e%2fetc%2fpasswd", "UPPER", "a b"):
        response = await client.get(f"/api/sessions/{bad}")
        assert response.status_code in (404, 422), bad
