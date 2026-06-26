"""forge/engine/scaffolder.py — Project file generation logic."""

from __future__ import annotations

import asyncio
import shutil
import tempfile
from pathlib import Path
from typing import Any, AsyncIterator

from forge.engine.template_vars import interpolate_directory


class ScaffoldError(Exception):
    """Raised when scaffolding fails."""


def preview_tree(config: dict[str, Any], config_path: Path) -> list[str]:
    """
    Return a list of strings representing the file tree that will be generated.
    Used by PreviewScreen before any action is taken.
    """
    source = config.get("source", {})
    src_type = source.get("type", "local")

    if src_type == "github":
        repo = source.get("repo", "<unknown>")
        branch = source.get("branch", "default")
        subfolder = source.get("subfolder", "")
        lines = [
            f"[GitHub] {repo}",
            f"  branch : {branch}",
        ]
        if subfolder:
            lines.append(f"  subfolder: {subfolder}")
        lines.append("  (actual tree visible after clone)")
        return lines

    # Local source
    files_dir_rel = source.get("files_dir", "./files")
    files_dir = (config_path / files_dir_rel).resolve()

    if not files_dir.exists():
        return ["(no local files directory found)"]

    lines: list[str] = []
    _walk_tree(files_dir, "", lines)
    return lines


def _walk_tree(path: Path, prefix: str, lines: list[str]) -> None:
    entries = sorted(path.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
    for i, entry in enumerate(entries):
        connector = "└── " if i == len(entries) - 1 else "├── "
        lines.append(f"{prefix}{connector}{entry.name}")
        if entry.is_dir():
            extension = "    " if i == len(entries) - 1 else "│   "
            _walk_tree(entry, prefix + extension, lines)


async def scaffold(
    config: dict[str, Any],
    config_path: Path,
    variables: dict[str, str],
    output_dir: Path,
) -> AsyncIterator[tuple[str, str]]:
    """
    Scaffold a project based on *config* into *output_dir*.

    Yields (status, message) tuples where status is one of:
      "running", "ok", "error", "info"
    """
    project_name = variables.get("project_name", "MyProject")
    project_dir = output_dir / project_name

    # ------------------------------------------------------------------ #
    # Step 1 — Create project directory
    # ------------------------------------------------------------------ #
    yield ("running", f"Creating project directory: {project_dir}")
    try:
        project_dir.mkdir(parents=True, exist_ok=False)
    except FileExistsError:
        yield ("error", f"Directory already exists: {project_dir}")
        return
    except OSError as e:
        yield ("error", f"Cannot create directory: {e}")
        return
    yield ("ok", f"Created: {project_dir}")

    # ------------------------------------------------------------------ #
    # Step 2 — Copy / clone source files
    # ------------------------------------------------------------------ #
    source = config.get("source", {})
    src_type = source.get("type", "local")

    if src_type == "local":
        async for item in _scaffold_local(config, config_path, variables, project_dir):
            yield item
    elif src_type == "github":
        async for item in _scaffold_github(config, source, variables, project_dir):
            yield item
    else:
        yield ("error", f"Unknown source type: {src_type!r}")
        return

    # ------------------------------------------------------------------ #
    # Step 3 — Git init
    # ------------------------------------------------------------------ #
    git_cfg = config.get("git", {})
    if git_cfg.get("init", False):
        from forge.engine.git_handler import git_init, git_add_all, git_commit, GitError
        branch = git_cfg.get("initial_branch", "main")
        yield ("running", f"Initialising git repository (branch: {branch})")
        try:
            await git_init(project_dir, branch)
            yield ("ok", "git init done")
        except GitError as e:
            yield ("error", str(e))

    # ------------------------------------------------------------------ #
    # Step 4 — Post-init commands
    # ------------------------------------------------------------------ #
    post_init = config.get("post_init", [])
    for step in post_init:
        cmd = step.get("cmd", "")
        label = step.get("label", cmd)
        if not cmd:
            continue
        yield ("running", label)
        from forge.engine.git_handler import run_command, GitError
        try:
            async for line in run_command(cmd, project_dir, label):
                yield ("info", line)
            yield ("ok", label)
        except GitError as e:
            yield ("error", str(e))

    yield ("ok", f"🎉 Project created at: {project_dir}")
    yield ("ok", f"   cd {project_dir} && code .")


async def _scaffold_local(
    config: dict[str, Any],
    config_path: Path,
    variables: dict[str, str],
    project_dir: Path,
) -> AsyncIterator[tuple[str, str]]:
    source = config.get("source", {})
    files_dir_rel = source.get("files_dir", "./files")
    files_dir = (config_path / files_dir_rel).resolve()

    yield ("running", f"Copying template files from {files_dir}")

    if not files_dir.exists():
        yield ("error", f"Template files directory not found: {files_dir}")
        return

    try:
        shutil.copytree(files_dir, project_dir, dirs_exist_ok=True)
    except Exception as e:
        yield ("error", f"File copy failed: {e}")
        return

    yield ("running", "Interpolating template variables")
    try:
        await asyncio.to_thread(interpolate_directory, project_dir, variables)
    except Exception as e:
        yield ("error", f"Variable interpolation failed: {e}")
        return

    yield ("ok", "Files copied and variables applied")


async def _scaffold_github(
    config: dict[str, Any],
    source: dict[str, Any],
    variables: dict[str, str],
    project_dir: Path,
) -> AsyncIterator[tuple[str, str]]:
    from forge.engine.git_handler import clone_repo, GitError

    repo = source.get("repo", "")
    branch = source.get("branch")
    subfolder = source.get("subfolder")

    if not repo:
        yield ("error", "GitHub source missing 'repo' field")
        return

    yield ("running", f"Cloning GitHub repo: {repo}")
    try:
        async for line in clone_repo(repo, project_dir, branch=branch, subfolder=subfolder):
            yield ("info", line)
    except GitError as e:
        yield ("error", str(e))
        return

    yield ("running", "Interpolating template variables")
    try:
        await asyncio.to_thread(interpolate_directory, project_dir, variables)
    except Exception as e:
        yield ("error", f"Variable interpolation failed: {e}")
        return

    # Remove .git folder from cloned repo so we start fresh
    dot_git = project_dir / ".git"
    if dot_git.exists():
        shutil.rmtree(dot_git, ignore_errors=True)

    yield ("ok", "GitHub repo cloned and variables applied")
