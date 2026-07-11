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
    for bad in ("../etc/passwd", "UPPER", "a b"):
        response = await client.put(f"/api/saves/{bad}", json=payload)
        assert response.status_code in (404, 422), bad


async def test_blank_name_rejected(client: AsyncClient):
    response = await client.put("/api/saves/ok-id", json={"name": "   ", "map": "m", "data": {}})
    assert response.status_code == 422
