"""forge/main.py — CLI entry point using Typer."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

import typer

from forge import __version__, __app_name__

app = typer.Typer(
    name=__app_name__,
    help="🔨 Forge — Interactive TUI project scaffolding tool",
    add_completion=False,
    rich_markup_mode="rich",
)


def _version_callback(value: bool) -> None:
    if value:
        typer.echo(f"{__app_name__} v{__version__}")
        raise typer.Exit()


@app.command()
def main(
    output_dir: Optional[Path] = typer.Option(
        None,
        "--output", "-o",
        help="Directory where the project will be created (default: current dir)",
        show_default=False,
    ),
    config_dir: Optional[Path] = typer.Option(
        None,
        "--configs", "-c",
        help="Extra configs directory to merge with built-in templates",
        show_default=False,
    ),
    no_tui: bool = typer.Option(
        False,
        "--no-tui",
        help="Run in non-interactive mode (for CI/scripting) — not yet implemented",
    ),
    version: Optional[bool] = typer.Option(
        None,
        "--version", "-v",
        callback=_version_callback,
        is_eager=True,
        help="Show version and exit",
    ),
) -> None:
    """
    Launch the interactive TUI to scaffold a new project.

    Navigate the template tree with ↑/↓/Enter/Backspace, fill in variables,
    then let Forge generate your project structure.
    """
    if no_tui:
        typer.echo("[--no-tui] Non-interactive mode is not yet implemented.", err=True)
        raise typer.Exit(code=1)

    # Validate git availability early
    import shutil
    if shutil.which("git") is None:
        typer.echo(
            "❌  git not found in PATH.\n"
            "    Please install git and make sure it is accessible before running forge.",
            err=True,
        )
        raise typer.Exit(code=1)

    # Resolve output directory
    dest = output_dir or Path.cwd()
    if not dest.exists():
        typer.echo(f"❌  Output directory does not exist: {dest}", err=True)
        raise typer.Exit(code=1)

    # Build extra config dirs list
    extra_dirs: list[Path] = []
    # Always include ~/.forge/configs if it exists
    user_configs = Path.home() / ".forge" / "configs"
    if user_configs.exists():
        extra_dirs.append(user_configs)
    if config_dir and config_dir.exists():
        extra_dirs.append(config_dir)

    # Launch TUI
    from forge.app import ForgeApp
    forge_app = ForgeApp(output_dir=dest, extra_config_dirs=extra_dirs)
    forge_app.run()


if __name__ == "__main__":
    app()
