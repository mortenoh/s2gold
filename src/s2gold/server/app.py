"""FastAPI application factory.

Serves the built frontend (packages/app/dist) and the converted game assets
(/assets) as static files, plus the /api endpoints (save games). Game logic
runs entirely client-side; this server owns serving and persistence only.
"""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from s2gold.server.config import Settings
from s2gold.server.routers import health, saves
from s2gold.server.saves import SaveStore


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    """Application lifespan handler."""
    yield


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create and configure the FastAPI application."""
    if settings is None:
        settings = Settings()

    app = FastAPI(title=settings.app_name, lifespan=lifespan)
    app.state.settings = settings
    app.state.save_store = SaveStore(settings.saves_dir)

    app.include_router(health.router)
    app.include_router(saves.router)

    # Converted game assets live outside dist so a frontend rebuild never has to
    # copy 75 MB; mount them explicitly, then the built app as the catch-all.
    if settings.assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=settings.assets_dir), name="assets")
    if settings.frontend_dist.is_dir():
        dist = settings.frontend_dist

        # Clean URLs (mirrored by the Vite dev middleware): /play[/<map>] -> game,
        # /inspector -> inspector. The <map> segment is resolved client-side.
        @app.get("/play", include_in_schema=False)
        @app.get("/play/{map_name}", include_in_schema=False)
        async def play_page(map_name: str = "") -> FileResponse:
            return FileResponse(dist / "game.html")

        @app.get("/inspector", include_in_schema=False)
        async def inspector_page() -> FileResponse:
            return FileResponse(dist / "inspector.html")

        # The menu is a single Vite entry that routes on pathname.
        @app.get("/setup", include_in_schema=False)
        async def setup_page() -> FileResponse:
            return FileResponse(dist / "index.html")

        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")

    return app


app = create_app()


def main() -> None:
    """Run the production server (uvicorn)."""
    import uvicorn

    settings = Settings()
    uvicorn.run(
        "s2gold.server.app:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )


if __name__ == "__main__":
    main()
