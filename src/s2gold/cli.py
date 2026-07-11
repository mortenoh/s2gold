"""s2gold command-line interface (typer).

Converter subcommands are registered by the modules under s2gold.convert as they land;
`install` runs extraction followed by every registered converter.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Annotated

import typer

from s2gold.core import ASSETS_DIR, EXTRACTED_DIR, OPTIONAL_TOOLS, REQUIRED_TOOLS, find_tool, run_tool

app = typer.Typer(no_args_is_help=True, help="Asset pipeline for the s2gold browser game.")


@app.command()
def doctor() -> None:
    """Check that the external tools the pipeline shells out to are installed."""
    missing = False
    for tool in REQUIRED_TOOLS:
        path = find_tool(tool)
        typer.echo(f"{tool:12} {'OK  ' + path if path else 'MISSING (required)'}")
        missing = missing or path is None
    for tool in OPTIONAL_TOOLS:
        path = find_tool(tool)
        typer.echo(f"{tool:12} {'OK  ' + path if path else 'missing (music/video conversion disabled)'}")
    if missing:
        raise typer.Exit(1)


@app.command()
def extract(
    installer: Annotated[Path, typer.Argument(help="Path to the GOG setup_the_settlers_2_gold_*.exe", exists=True)],
    dest: Annotated[Path, typer.Option(help="Extraction destination")] = EXTRACTED_DIR,
) -> None:
    """Extract the GOG installer with innoextract (idempotent; skips if already extracted)."""
    if (dest / "DATA" / "RESOURCE.IDX").exists():
        typer.echo(f"already extracted at {dest}, skipping (delete the directory to force)")
        return
    if find_tool("innoextract") is None:
        typer.echo("innoextract not found — install it first (brew install innoextract)", err=True)
        raise typer.Exit(1)
    # Extract into a sibling temp dir and promote on success, so an interrupted
    # run never leaves a partial tree that later runs mistake for complete.
    tmp = dest.with_name(dest.name + ".partial")
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    typer.echo(f"extracting {installer.name} -> {dest}")
    run_tool(["innoextract", "-d", str(tmp), "-s", str(installer)])
    if dest.exists():
        shutil.rmtree(dest)
    tmp.replace(dest)
    typer.echo("extraction complete")


@app.command()
def install(
    installer: Annotated[Path, typer.Argument(help="Path to the GOG setup_the_settlers_2_gold_*.exe", exists=True)],
    assets: Annotated[Path, typer.Option(help="Converted assets output directory")] = ASSETS_DIR,
) -> None:
    """Extract the installer and convert all game assets for the browser app."""
    extract(installer, EXTRACTED_DIR)
    from s2gold.convert import run_all  # noqa: PLC0415 - converters land incrementally

    run_all(EXTRACTED_DIR, assets)
    typer.echo(f"assets ready at {assets}")


def main() -> None:
    """CLI entry point."""
    app()


if __name__ == "__main__":
    main()
