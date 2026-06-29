"""forge/engine/scaffolder.py — Project file generation logic.

Execution order
----------------
  1. config    — the project's own ``source`` steps (local/github/command/script)
  2. templates — reusable directory skeletons listed in config["templates"]
  3. plugins   — reusable extensions listed in config["plugins"]
  4. extras    — Dockerfile / docker-compose / CI-CD / pipeline (see below)
  5. git init
  6. post_init — config-defined commands (interactive)
  7. pipeline  — build/test/format commands from the stack constructor (interactive)
  8. git add + commit — always, with the same message for every project

"Always present" variables
---------------------------
Dockerfile, docker-compose, CI/CD (+ provider), and the build/test/format
pipeline are offered for *every* project regardless of what config.json
says — they are deliberately NOT declared as config.json "variables".
Instead, the caller (TUI or --no-tui) collects them into the same
``variables`` dict under reserved keys:

  forge_dockerfile        "true"/"false"
  forge_docker_compose    "true"/"false"
  forge_cicd              "true"/"false"
  forge_cicd_provider     "github-actions" | "gitlab-ci" | "azure-devops"
  forge_pipeline          comma-separated steps, e.g. "build,test,format"

What "build"/"test"/"format" actually run is dispatched per tech stack via
``forge/engine/constructors`` (nodejs.py, dotnet.py, ...). A config.json MAY
narrow or extend the *default* step list via a top-level ``"pipeline"``
array (e.g. ``"pipeline": ["build", "test"]`` to drop format) — this changes
the default the TUI proposes, not whether the feature exists at all.

Interactive execution
----------------------
Every step that shells out to an external command/script (source command/script
steps, plugin/template command/script apply steps, post_init, and pipeline
commands) is run through an injectable ``step_runner`` callable instead of a
captured/piped subprocess:

    async def step_runner(cmd: str, cwd: Path, label: str, env: dict[str, str]) -> int

This exists so a TUI can hand the *real* terminal over to the child process
(e.g. via Textual's ``with app.suspend():``) so interactive prompts/wizards
work and the screen doesn't block — see RunScreen. The default runner (used
by --no-tui and tests) simply inherits the current process's stdio.

Only the purely-internal steps (local file copy + interpolation, git init,
the final git add/commit) still use the old captured/streamed approach,
since they're never interactive and benefit from a clean log line.
"""

from __future__ import annotations

import asyncio
import platform
import shutil
from pathlib import Path
from typing import Any, Awaitable, Callable, AsyncIterator

from forge.engine.asset_loader import copy_asset_files
from forge.engine.template_vars import interpolate_directory, interpolate_string

# (cmd, cwd, label, env) -> exit code. See module docstring.
StepRunner = Callable[[str, Path, str, dict[str, str]], Awaitable[int]]

DEFAULT_PIPELINE = ["build", "test", "format"]


class ScaffoldError(Exception):
    """Raised when scaffolding fails."""


def _truthy(value: Any) -> bool:
    return str(value).strip().lower() in ("1", "true", "yes", "y", "on")


async def _default_step_runner(cmd: str, cwd: Path, label: str, env: dict[str, str]) -> int:
    """Used when no step_runner is supplied (--no-tui, tests, library use).

    Inherits the current process's stdio directly — fine in a plain terminal
    since there's no TUI to corrupt. TUIs should supply their own runner.
    """
    from forge.engine.git_handler import run_interactive
    return await run_interactive(cmd, cwd, env)


def _normalize_source(config: dict[str, Any]) -> list[dict[str, Any]]:
    """Return config['source'] as a list of step dicts, defaulting type to 'local'.

    A config with no "source" key at all (relying purely on templates/plugins
    to populate the project) yields an empty list rather than an implicit,
    likely-missing "./files" local step.
    """
    if "source" not in config:
        return []
    source = config["source"]
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


def _ref_id(raw_ref: Any) -> dict[str, Any]:
    """A plugin/template reference is either a bare id string or a dict with overrides."""
    return {"id": raw_ref} if isinstance(raw_ref, str) else dict(raw_ref)


def preview_tree(config: dict[str, Any], config_path: Path) -> list[str]:
    """
    Return a list of strings describing what each source step will do, plus
    which templates/plugins are wired up. Used by PreviewScreen before any
    action is taken.
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

    templates_ids = [_ref_id(t).get("id", "?") for t in config.get("templates", [])]
    if templates_ids:
        lines.append("")
        lines.append("[Templates] " + ", ".join(templates_ids))

    plugins_ids = [_ref_id(p).get("id", "?") for p in config.get("plugins", [])]
    if plugins_ids:
        lines.append("[Plugins available] " + ", ".join(plugins_ids))

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
    plugin_loader: Any = None,
    template_loader: Any = None,
    step_runner: StepRunner | None = None,
) -> AsyncIterator[tuple[str, str]]:
    """
    Scaffold a project based on *config* into *output_dir*.

    Yields (status, message) tuples where status is one of:
      "running", "ok", "error", "info"

    *plugin_loader* / *template_loader*, if given, resolve the ids in
    config['plugins'] / config['templates']. If omitted, default loaders
    (built-in assets only) are created automatically.

    *step_runner*, if given, is used for every externally-spawned command
    (see module docstring) instead of the default inherited-stdio runner —
    this is how a TUI hands the real terminal over for interactive installs.
    """
    if step_runner is None:
        step_runner = _default_step_runner

    project_name = variables.get("project_name", "MyProject")
    project_dir = output_dir / project_name
    steps = _normalize_source(config)

    # ------------------------------------------------------------------ #
    # 1a — Create project directory (unless the first step creates it)
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
    # 1b — Run each "config" source step in order
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
            async for item in _scaffold_command(step, variables, run_cwd, step_runner):
                yield item
        elif src_type == "script":
            async for item in _scaffold_script(step, config_path, variables, run_cwd, step_runner):
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
    # 2 — Templates: both the flat "templates": [ids] list, and the
    #     recursive "structure" DSL (folders/templates/typed dotnet projects)
    # ------------------------------------------------------------------ #
    async for item in apply_templates(config, variables, project_dir, template_loader, step_runner):
        yield item

    from forge.engine.structure import apply_structure
    async for item in apply_structure(config, variables, project_dir, template_loader, step_runner):
        yield item

    # ------------------------------------------------------------------ #
    # 3 — Plugins (extensions)
    # ------------------------------------------------------------------ #
    async for item in apply_plugins(config, variables, project_dir, plugin_loader, step_runner):
        yield item

    # ------------------------------------------------------------------ #
    # 4 — Extras: Dockerfile / docker-compose / CI-CD / pipeline
    #     ("always present" variables, never declared in config.json)
    # ------------------------------------------------------------------ #
    from forge.engine.constructors import get_constructor

    constructor = get_constructor(config)
    pipeline = list(config.get("pipeline", DEFAULT_PIPELINE))
    requested_pipeline = variables.get("forge_pipeline")
    if requested_pipeline is not None and str(requested_pipeline).strip():
        pipeline = [s.strip() for s in str(requested_pipeline).split(",") if s.strip()]

    if _truthy(variables.get("forge_dockerfile")):
        yield ("running", "Generating Dockerfile")
        (project_dir / "Dockerfile").write_text(constructor.dockerfile(variables), encoding="utf-8")
        yield ("ok", "Dockerfile created")

    if _truthy(variables.get("forge_docker_compose")):
        yield ("running", "Generating docker-compose.yml")
        (project_dir / "docker-compose.yml").write_text(constructor.docker_compose(variables), encoding="utf-8")
        yield ("ok", "docker-compose.yml created")

    if _truthy(variables.get("forge_cicd")):
        provider = variables.get("forge_cicd_provider", "github-actions")
        yield ("running", f"Generating CI/CD workflow ({provider})")
        files = constructor.ci_workflow(provider, pipeline, variables)
        if not files:
            yield (
                "info",
                f"No CI/CD template for provider={provider!r} on stack={constructor.stack_id!r}",
            )
        else:
            for rel_path, content in files.items():
                target = project_dir / rel_path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8")
            yield ("ok", "CI/CD workflow created")

    # ------------------------------------------------------------------ #
    # 5 — Git init (always)
    # ------------------------------------------------------------------ #
    from forge.engine.git_handler import git_init, finalize_git, GitError

    branch = config.get("git", {}).get("initial_branch", "main")
    yield ("running", f"Initialising git repository (branch: {branch})")
    try:
        await git_init(project_dir, branch)
        yield ("ok", "git init done")
    except GitError as e:
        yield ("error", str(e))

    # ------------------------------------------------------------------ #
    # 6 — post_init commands (config-defined, interactive)
    # ------------------------------------------------------------------ #
    async for item in _run_commands_interactive(config.get("post_init", []), variables, project_dir, step_runner):
        yield item

    # ------------------------------------------------------------------ #
    # 7 — Pipeline commands (build/test/format, interactive)
    # ------------------------------------------------------------------ #
    pipeline_cmds = constructor.pipeline_commands(pipeline, variables)
    if pipeline_cmds:
        async for item in _run_commands_interactive(pipeline_cmds, variables, project_dir, step_runner):
            yield item

    # ------------------------------------------------------------------ #
    # 8 — git add + commit — always, identical message for every project
    # ------------------------------------------------------------------ #
    yield ("running", "Staging files and creating the initial commit")
    try:
        await finalize_git(project_dir)
        yield ("ok", "Initial commit created")
    except GitError as e:
        yield ("error", str(e))

    yield ("ok", f"🎉 Project created at: {project_dir}")
    yield ("ok", f"   cd {project_dir} && code .")


async def _run_commands_interactive(
    commands: list[dict[str, Any]],
    variables: dict[str, str],
    cwd: Path,
    step_runner: StepRunner,
) -> AsyncIterator[tuple[str, str]]:
    """Run a list of {"cmd", "label"} dicts via step_runner, best-effort
    (a failing command is reported but doesn't stop the rest)."""
    env = _vars_to_env(variables)
    for entry in commands:
        cmd_raw = entry.get("cmd", "")
        if not cmd_raw:
            continue
        label = entry.get("label") or cmd_raw
        cmd = interpolate_string(cmd_raw, variables)
        yield ("running", label)
        rc = await step_runner(cmd, cwd, label, env)
        if rc != 0:
            yield ("error", f"{label} failed (exit {rc})")
        else:
            yield ("ok", label)


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
    step_runner: StepRunner,
) -> AsyncIterator[tuple[str, str]]:
    """Run a list of CLI commands directly — no static template files involved.

    Each command's ``{{variable}}`` placeholders are interpolated, and the
    command is executed via *step_runner* (interactive — see module docstring).
    """
    commands = step.get("commands", [])
    if not commands:
        yield ("error", "Command source step has no 'commands' defined")
        return

    env = _vars_to_env(variables)
    for entry in commands:
        raw_cmd = entry.get("cmd", "")
        if not raw_cmd:
            continue
        label = entry.get("label", raw_cmd)
        cmd = interpolate_string(raw_cmd, variables)
        yield ("running", label)
        rc = await step_runner(cmd, run_cwd, label, env)
        if rc != 0:
            yield ("error", f"{label} failed (exit {rc})")
            return
        yield ("ok", label)


async def _scaffold_script(
    step: dict[str, Any],
    config_path: Path,
    variables: dict[str, str],
    run_cwd: Path,
    step_runner: StepRunner,
) -> AsyncIterator[tuple[str, str]]:
    """Run a single script (bash / Git Bash / cmd / ps1) interactively via step_runner.

    See ``script_runner.py`` for how the script type is resolved into a
    runnable command on each OS.
    """
    from forge.engine.script_runner import build_script_command, quote_command, ScriptRunnerError

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

    try:
        parts = build_script_command(script_path, args)
    except ScriptRunnerError as e:
        yield ("error", str(e))
        return

    cmd = quote_command(parts)
    env = _vars_to_env(variables)
    yield ("running", label)
    rc = await step_runner(cmd, run_cwd, label, env)
    if rc != 0:
        yield ("error", f"{label} failed (exit {rc})")
        return
    yield ("ok", label)


# ====================================================================== #
# Templates / Plugins — shared "asset reference" application logic
# ====================================================================== #
#
# Both are referenced from config.json the same way:
#
#   "templates": ["react/structure"]
#   "plugins":   ["dotnet/jwt", { "id": "dotnet/efcore/interceptor", "variables": {...} }]
#
# and applied with the same "local" / "command" / "script" mechanics as
# config source steps.


async def apply_templates(
    config: dict[str, Any],
    variables: dict[str, str],
    project_dir: Path,
    template_loader: Any,
    step_runner: StepRunner,
) -> AsyncIterator[tuple[str, str]]:
    """Apply every directory-skeleton template listed in config['templates']."""
    loader = template_loader
    if loader is None:
        from forge.engine.templates_loader import TemplateLoader
        loader = TemplateLoader()
    async for item in _apply_asset_refs(config, "templates", "template", variables, project_dir, loader, step_runner):
        yield item


async def apply_plugins(
    config: dict[str, Any],
    variables: dict[str, str],
    project_dir: Path,
    plugin_loader: Any,
    step_runner: StepRunner,
) -> AsyncIterator[tuple[str, str]]:
    """Apply every plugin listed in config['plugins'], in order, into project_dir."""
    loader = plugin_loader
    if loader is None:
        from forge.engine.plugin_loader import PluginLoader
        loader = PluginLoader()
    async for item in _apply_asset_refs(config, "plugins", "plugin", variables, project_dir, loader, step_runner):
        yield item


async def _apply_asset_refs(
    config: dict[str, Any],
    field_name: str,
    manifest_name: str,
    variables: dict[str, str],
    project_dir: Path,
    loader: Any,
    step_runner: StepRunner,
) -> AsyncIterator[tuple[str, str]]:
    for raw_ref in config.get(field_name, []):
        ref = _ref_id(raw_ref)
        asset_id = ref.get("id", "")
        if not asset_id:
            yield ("error", f"{manifest_name.capitalize()} reference missing 'id'")
            continue

        try:
            asset = loader.get(asset_id)
        except KeyError as e:
            yield ("error", str(e))
            continue

        asset_cfg = asset.config
        display_name = asset_cfg.get("name", asset_id)
        yield ("running", f"Applying {manifest_name}: {display_name}")

        # Merge variables: asset's own defaults < project variables < per-reference overrides
        merged_vars: dict[str, str] = {
            v["key"]: str(v.get("default", ""))
            for v in asset_cfg.get("variables", [])
            if v.get("key")
        }
        merged_vars.update(variables)
        merged_vars.update({k: str(v) for k, v in ref.get("variables", {}).items()})

        target_dir_rel = ref.get("target_dir", asset_cfg.get("target_dir", "."))
        target_dir = (project_dir / interpolate_string(target_dir_rel, merged_vars)).resolve()

        apply_cfg = asset_cfg.get("apply", {})
        apply_type = apply_cfg.get("type", "local")

        if apply_type == "local":
            async for item in _apply_asset_local(apply_cfg, asset.path, manifest_name, merged_vars, target_dir):
                yield item
        elif apply_type == "command":
            async for item in _run_commands_interactive(
                apply_cfg.get("commands", []), merged_vars, project_dir, step_runner
            ):
                yield item
        elif apply_type == "script":
            async for item in _scaffold_script(apply_cfg, asset.path, merged_vars, project_dir, step_runner):
                yield item
        else:
            yield ("error", f"Unknown {manifest_name} apply type: {apply_type!r}")
            continue

        post_apply = asset_cfg.get("post_apply", [])
        if post_apply:
            async for item in _run_commands_interactive(post_apply, merged_vars, project_dir, step_runner):
                yield item

        yield ("ok", f"{manifest_name.capitalize()} applied: {display_name}")


async def _apply_asset_local(
    apply_cfg: dict[str, Any],
    asset_path: Path,
    manifest_name: str,
    variables: dict[str, str],
    target_dir: Path,
) -> AsyncIterator[tuple[str, str]]:
    files_dir_rel = apply_cfg.get("files_dir", ".")
    files_dir = (asset_path / files_dir_rel).resolve()

    yield ("running", f"Copying files from {files_dir}")

    if not files_dir.exists():
        yield ("error", f"Files directory not found: {files_dir}")
        return

    try:
        if files_dir == asset_path:
            # Default case: payload lives directly alongside the manifest —
            # exclude the manifest itself and any nested sub-asset folders.
            copy_asset_files(files_dir, target_dir, manifest_name)
        else:
            target_dir.mkdir(parents=True, exist_ok=True)
            shutil.copytree(files_dir, target_dir, dirs_exist_ok=True)
    except Exception as e:
        yield ("error", f"File copy failed: {e}")
        return

    yield ("running", "Interpolating variables")
    try:
        await asyncio.to_thread(interpolate_directory, target_dir, variables)
    except Exception as e:
        yield ("error", f"Variable interpolation failed: {e}")
        return

    yield ("ok", "Files copied and variables applied")