"""forge/main.py — CLI entry point using Typer."""

from __future__ import annotations

import asyncio
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
    plugin_dir: Optional[Path] = typer.Option(
        None,
        "--plugins",
        help="Extra plugins directory to merge with built-in plugins",
        show_default=False,
    ),
    template_dir: Optional[Path] = typer.Option(
        None,
        "--templates",
        help="Extra directory-templates folder to merge with built-in templates",
        show_default=False,
    ),
    no_tui: bool = typer.Option(
        False,
        "--no-tui",
        help="Run in non-interactive mode (for CI/scripting). Requires --config-id.",
    ),
    config_id: Optional[str] = typer.Option(
        None,
        "--config-id",
        help="(--no-tui) slash-separated config id to scaffold, e.g. 'react/vite-cli'",
        show_default=False,
    ),
    var: list[str] = typer.Option(
        [],
        "--var",
        help="(--no-tui) set a template variable as key=value (repeatable)",
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
    Launch the interactive TUI to scaffold a new project, or run headless
    with --no-tui --config-id <id> --var key=value ... for CI/scripting.
    """
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

    # Build extra dirs lists (built-in + ~/.forge/<kind> + explicit flag)
    def _extra_dirs(flag_dir: Optional[Path], kind: str) -> list[Path]:
        dirs: list[Path] = []
        user_dir = Path.home() / ".forge" / kind
        if user_dir.exists():
            dirs.append(user_dir)
        if flag_dir and flag_dir.exists():
            dirs.append(flag_dir)
        return dirs

    extra_config_dirs = _extra_dirs(config_dir, "configs")
    extra_plugin_dirs = _extra_dirs(plugin_dir, "plugins")
    extra_template_dirs = _extra_dirs(template_dir, "templates")

    if no_tui:
        if not config_id:
            typer.echo("❌  --no-tui requires --config-id <id> (e.g. 'react/vite-cli')", err=True)
            raise typer.Exit(code=1)
        exit_code = asyncio.run(
            _run_no_tui(
                config_id=config_id,
                raw_vars=var,
                output_dir=dest,
                extra_config_dirs=extra_config_dirs,
                extra_plugin_dirs=extra_plugin_dirs,
                extra_template_dirs=extra_template_dirs,
            )
        )
        raise typer.Exit(code=exit_code)

    # Launch TUI
    from forge.app import ForgeApp
    forge_app = ForgeApp(
        output_dir=dest,
        extra_config_dirs=extra_config_dirs,
        extra_plugin_dirs=extra_plugin_dirs,
        extra_template_dirs=extra_template_dirs,
    )
    forge_app.run()


async def _run_no_tui(
    config_id: str,
    raw_vars: list[str],
    output_dir: Path,
    extra_config_dirs: list[Path],
    extra_plugin_dirs: list[Path],
    extra_template_dirs: list[Path],
) -> int:
    """Headless scaffold: no TUI, no piping — the real terminal is already
    free, so commands (including interactive ones) just run directly."""
    from forge.engine.config_loader import ConfigLoader
    from forge.engine.plugin_loader import PluginLoader
    from forge.engine.templates_loader import TemplateLoader
    from forge.engine.scaffolder import scaffold

    loader = ConfigLoader(extra_config_dirs=extra_config_dirs)
    tree = loader.get_tree()

    node = _find_node_by_id(tree, config_id.strip("/").split("/"))
    if node is None or not node.is_leaf:
        typer.echo(f"❌  Unknown config id: {config_id!r}", err=True)
        return 1

    config = node.load_config()

    # Parse --var key=value
    variables: dict[str, str] = {}
    for v in raw_vars:
        if "=" not in v:
            typer.echo(f"❌  Invalid --var {v!r}, expected key=value", err=True)
            return 1
        key, value = v.split("=", 1)
        variables[key.strip()] = value

    # Fill in any declared variable not already supplied, prompting (with default) on a real TTY.
    for var_def in config.get("variables", []):
        key = var_def.get("key")
        if not key or key in variables:
            continue
        default = str(var_def.get("default", ""))
        if sys.stdin.isatty():
            label = var_def.get("label", key)
            entered = input(f"{label} [{default}]: ").strip()
            variables[key] = entered or default
        else:
            variables[key] = default

    typer.echo(f"▶ Scaffolding {config.get('name', config_id)} into {output_dir}\n")

    exit_code = 0
    async for status, message in scaffold(
        config=config,
        config_path=node.path,
        variables=variables,
        output_dir=output_dir,
        plugin_loader=PluginLoader(extra_plugin_dirs=extra_plugin_dirs),
        template_loader=TemplateLoader(extra_template_dirs=extra_template_dirs),
        # step_runner left as default: inherits this process's stdio directly,
        # since there's no TUI here to take the terminal away from.
    ):
        icon = {"running": "⏳", "ok": "✅", "error": "❌", "info": "ℹ️ "}.get(status, "•")
        typer.echo(f"{icon} {message}")
        if status == "error":
            exit_code = 1

    return exit_code


def _find_node_by_id(root, parts: list[str]):
    """Walk a ConfigLoader TreeNode tree by folder-name path components."""
    node = root
    for part in parts:
        match = None
        for child in node.children:
            slug = child.path.name
            if slug == part or slug.replace("-", " ").replace("_", " ").lower() == part.replace("-", " ").lower():
                match = child
                break
        if match is None:
            return None
        node = match
    return node


if __name__ == "__main__":
    app()
