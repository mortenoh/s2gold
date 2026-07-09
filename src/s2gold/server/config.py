"""Server configuration via environment variables (prefix S2GOLD_)."""

from pathlib import Path

from pydantic_settings import BaseSettings

from s2gold.core import ASSETS_DIR, REPO_ROOT


class Settings(BaseSettings):
    """Application settings loaded from the environment."""

    app_name: str = "s2gold"
    debug: bool = False
    host: str = "127.0.0.1"
    port: int = 8000
    assets_dir: Path = ASSETS_DIR
    frontend_dist: Path = REPO_ROOT / "packages" / "app" / "dist"
    saves_dir: Path = REPO_ROOT / "saves"

    model_config = {"env_prefix": "S2GOLD_"}
