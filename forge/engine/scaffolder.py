"""forge/engine/scaffolder.py — Project file generation logic.

Source steps
------------
``config["source"]`` may be a single step (dict) or a list of steps,
executed in order. Each step has a ``"type"`` of:

  - ``"local"``   — copy a static ``files_dir`` template (the original behaviour)
  - ``"github"``  — clone a GitHub repo as the template base
  - ``"command"`` — run one or more CLI commands directly (e.g. the project's
                     own official generator: ``npm create vite@latest``,
                     ``dotnet new webapi``, ``cargo new``, …)
  - ``"script"``  — run a single bash script (or a Windows counterpart)

``command`` and ``script`` steps can be used instead of a static template
("stop using templates"), or alongside one in the same step list — e.g. run
the official CLI first, then layer extra files on top.

By default, a ``command``/``script`` step that is *first* in the list is
assumed to create the project directory itself (``creates_dir: true``), so
Forge does not pre-create it and runs the step with cwd = the parent output
directory. Set ``"creates_dir": false`` to have Forge create the directory
first and run the step inside it instead.
"""

from __future__ import annotations

import asyncio
import platform
import shutil
import stat
from pathlib import Path
from typing import Any, AsyncIterator

from forge.engine.template_vars import interpolate_directory, interpolate_string


class ScaffoldError(Exception):
    """Raised when scaffolding fails."""


def _normalize_source(config: dict[str, Any]) -> list[dict[str, Any]]:
    """Return config['source'] as a list of step dicts, defaulting type to 'local'."""
    source = config.get("source", {})
    steps = source if isinstance(source, list) else [source]
    normalized = []
    for step in steps:
        step = dict(step)
        step.setdefault("type", "local")
        normalized.append(step)
    return normalized


def _vars_to_env(variables: dict[str, str]) -> dict[str, str]:
    """Expose template variables as FORGE_VAR_<UPPER_KEY> environment variables."""
    return {f"FORGE_VAR_{key.upper()}": str(value) for key, value in variables.items()}


def preview_tree(config: dict[str, Any], config_path: Path) -> list[str]:
    """
    Return a list of strings describing what each source step will do.
    Used by PreviewScreen before any action is taken.
    """
    steps = _normalize_source(config)
    lines: list[str] = []
    multi = len(steps) > 1

    for i, step in enumerate(steps, start=1):
        prefix = f"[{i}] " if multi else ""
        src_type = step.get("type", "local")

        if src_type == "github":
            repo = step.get("repo", "<unknown>")
            branch = step.get("branch", "default")
            subfolder = step.get("subfolder", "")
            lines.append(f"{prefix}[GitHub] {repo}")
            lines.append(f"{'    ' if multi else '  '}branch : {branch}")
            if subfolder:
                lines.append(f"{'    ' if multi else '  '}subfolder: {subfolder}")
            lines.append(f"{'    ' if multi else '  '}(actual tree visible after clone)")

        elif src_type == "command":
            commands = step.get("commands", [])
            lines.append(f"{prefix}[Command] {len(commands)} command(s) will run:")
            for c in commands:
                lines.append(f"    $ {c.get('cmd', '')}")
            if not commands:
                lines.append("    (no commands defined)")

        elif src_type == "script":
            script = step.get("script", "<undefined>")
            lines.append(f"{prefix}[Script] {script}")
            if step.get("script_windows"):
                lines.append(f"    windows: {step['script_windows']}")
            if step.get("args"):
                lines.append(f"    args: {' '.join(str(a) for a in step['args'])}")

        else:  # local
            files_dir_rel = step.get("files_dir", "./files")
            files_dir = (config_path / files_dir_rel).resolve()
            if not files_dir.exists():
                lines.append(f"{prefix}(no local files directory found: {files_dir_rel})")
                continue
            sub_lines: list[str] = []
            _walk_tree(files_dir, "", sub_lines)
            if multi:
                lines.append(f"{prefix}[Local] {files_dir_rel}")
                sub_lines = [f"    {line}" for line in sub_lines]
            lines.extend(sub_lines)

    if not lines:
        lines.append("(no source steps configured)")
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
    steps = _normalize_source(config)
    env_extra = _vars_to_env(variables)

    # ------------------------------------------------------------------ #
    # Step 1 — Create project directory (unless the first step creates it)
    # ------------------------------------------------------------------ #
    first_step = steps[0] if steps else {}
    first_creates_own_dir = (
        first_step.get("type") in ("command", "script")
        and first_step.get("creates_dir", True)
    )

    if first_creates_own_dir:
        if project_dir.exists():
            yield ("error", f"Directory already exists: {project_dir}")
            return
        yield ("info", f"Project directory will be created by the {first_step['type']} step")
    else:
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
    # Step 2 — Run each source step in order
    # ------------------------------------------------------------------ #
    for i, step in enumerate(steps):
        src_type = step.get("type", "local")
        step_creates_own_dir = i == 0 and first_creates_own_dir
        run_cwd = output_dir if step_creates_own_dir else project_dir

        if src_type == "local":
            async for item in _scaffold_local(step, config_path, variables, project_dir):
                yield item
        elif src_type == "github":
            async for item in _scaffold_github(step, variables, project_dir):
                yield item
        elif src_type == "command":
            async for item in _scaffold_command(step, variables, run_cwd, env_extra):
                yield item
        elif src_type == "script":
            async for item in _scaffold_script(step, config_path, variables, run_cwd, env_extra):
                yield item
        else:
            yield ("error", f"Unknown source type: {src_type!r}")
            return

        if step_creates_own_dir and not project_dir.exists():
            yield (
                "error",
                f"Expected the {src_type} step to create {project_dir}, but it does not exist.",
            )
            return

    # ------------------------------------------------------------------ #
    # Step 3 — Git init
    # ------------------------------------------------------------------ #
    git_cfg = config.get("git", {})
    if git_cfg.get("init", False):
        from forge.engine.git_handler import git_init, GitError
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
    for post_step in post_init:
        cmd = post_step.get("cmd", "")
        label = post_step.get("label", cmd)
        if not cmd:
            continue
        yield ("running", label)
        from forge.engine.git_handler import run_command, GitError
        try:
            async for line in run_command(
                interpolate_string(cmd, variables), project_dir, label, env=env_extra
            ):
                yield ("info", line)
            yield ("ok", label)
        except GitError as e:
            yield ("error", str(e))

    yield ("ok", f"🎉 Project created at: {project_dir}")
    yield ("ok", f"   cd {project_dir} && code .")


async def _scaffold_local(
    step: dict[str, Any],
    config_path: Path,
    variables: dict[str, str],
    project_dir: Path,
) -> AsyncIterator[tuple[str, str]]:
    files_dir_rel = step.get("files_dir", "./files")
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
    step: dict[str, Any],
    variables: dict[str, str],
    project_dir: Path,
) -> AsyncIterator[tuple[str, str]]:
    from forge.engine.git_handler import clone_repo, GitError

    repo = step.get("repo", "")
    branch = step.get("branch")
    subfolder = step.get("subfolder")

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


async def _scaffold_command(
    step: dict[str, Any],
    variables: dict[str, str],
    run_cwd: Path,
    env_extra: dict[str, str],
) -> AsyncIterator[tuple[str, str]]:
    """Run a list of CLI commands directly — no static template files involved.

    Each command's ``{{variable}}`` placeholders are interpolated, and all
    variables are additionally exported as FORGE_VAR_* environment variables.
    """
    from forge.engine.git_handler import run_command, GitError

    commands = step.get("commands", [])
    if not commands:
        yield ("error", "Command source step has no 'commands' defined")
        return

    for entry in commands:
        raw_cmd = entry.get("cmd", "")
        if not raw_cmd:
            continue
        label = entry.get("label", raw_cmd)
        cmd = interpolate_string(raw_cmd, variables)
        yield ("running", label)
        try:
            async for line in run_command(cmd, run_cwd, label, env=env_extra):
                yield ("info", line)
            yield ("ok", label)
        except GitError as e:
            yield ("error", str(e))
            return


async def _scaffold_script(
    step: dict[str, Any],
    config_path: Path,
    variables: dict[str, str],
    run_cwd: Path,
    env_extra: dict[str, str],
) -> AsyncIterator[tuple[str, str]]:
    """Run a single bash (or Windows) script as the scaffolding mechanism.

    Variables are passed both as interpolated positional ``args`` and as
    FORGE_VAR_* environment variables, so the script can use whichever is
    more convenient.
    """
    from forge.engine.git_handler import run_command, GitError

    is_windows = platform.system() == "Windows"
    script_rel = step.get("script_windows") if (is_windows and step.get("script_windows")) else step.get("script")

    if not script_rel:
        yield ("error", "Script source step has no 'script' defined")
        return

    script_path = (config_path / script_rel).resolve()
    if not script_path.exists():
        yield ("error", f"Script not found: {script_path}")
        return

    args = [interpolate_string(str(a), variables) for a in step.get("args", [])]
    label = step.get("label", f"Run script: {script_path.name}")

    if is_windows:
        if script_path.suffix.lower() == ".ps1":
            parts = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", f'"{script_path}"', *args]
        else:
            parts = [f'"{script_path}"', *args]
    else:
        # Ensure the script is executable, then run it via bash explicitly
        # so a missing shebang or exec bit doesn't break scaffolding.
        try:
            script_path.chmod(script_path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        except OSError:
            pass
        parts = ["bash", f'"{script_path}"', *args]

    cmd = " ".join(parts)
    yield ("running", label)
    try:
        async for line in run_command(cmd, run_cwd, label, env=env_extra):
            yield ("info", line)
        yield ("ok", label)
    except GitError as e:
        yield ("error", str(e))
