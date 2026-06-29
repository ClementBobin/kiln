"""forge/engine/structure.py — The "structure" field: a recursive folder/template DSL.

Some configs describe their layout with a ``"structure"`` field instead of
(or alongside) ``"source"``/``"templates"``. It's a recursive tree where a
node is either:

  - a **dict**, whose keys are either reserved (``"folders"``, ``"templates"``,
    and the dotnet-project keys below) or arbitrary subfolder names mapping
    to a *nested* node — that subfolder is created, then the nested node is
    applied inside it.
  - a **list**, where each element is either a bare string (a plain empty
    subfolder, created with no content) or a single-key dict ``{name: node}``
    (a named subfolder with a nested node, same as the dict form above).

Reserved keys on a dict node:

  - ``"folders": [str, ...]``   — plain empty subfolders created here
  - ``"templates": [str, ...]`` — directory-templates applied directly here
    (see ``templates_loader.py`` — same ids as a config's flat ``"templates"``
    list, just placed at this exact spot in the tree instead of the
    template's own default ``target_dir``)
  - ``"type": "class-library" | "web-api" | "unit-test" | <any dotnet template short name>``
    — this folder *is* a dotnet project: ``dotnet new <type> -n <key> -o <key>``
    is run instead of a plain ``mkdir``, then "folders"/"templates" apply
    inside the resulting project folder. ``"lib"`` picks the test framework
    for ``"unit-test"`` (default ``xunit``).
  - ``"references": [str, ...]`` — (dotnet "type" nodes only) sibling project
    names to wire up via ``dotnet add reference`` once every typed project
    in the tree has been created.

After the whole tree is walked, if any typed project was created, a
solution file is created (unless one already exists) and every typed
project is added to it, then references are wired up.

Example (see ``forge/configs/dotnet/aspnet/api-core/config 4 couches.json``)::

    "structure": {
      "Api": { "type": "web-api", "folders": ["Controllers"], "references": ["Domain"] },
      "Domain": { "type": "class-library", "folders": ["Entities"] }
    }
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, AsyncIterator

# Map our generic "type" vocabulary to dotnet template short names.
_DOTNET_TYPE_MAP = {
    "class-library": "classlib",
    "web-api": "webapi",
}

_RESERVED_KEYS = {"folders", "templates", "type", "lib", "references"}


async def apply_structure(
    config: dict[str, Any],
    variables: dict[str, str],
    project_dir: Path,
    template_loader: Any,
    step_runner: Any,
) -> AsyncIterator[tuple[str, str]]:
    """Apply config['structure'] (if present) into project_dir."""
    structure = config.get("structure")
    if not structure:
        return

    typed_projects: list[tuple[Path, dict[str, Any]]] = []

    async for item in _apply_node(structure, project_dir, project_dir, variables, template_loader, step_runner, typed_projects):
        yield item

    if not typed_projects:
        return

    async for item in _finalize_dotnet_solution(project_dir, variables, step_runner, typed_projects):
        yield item


async def _apply_node(
    node: Any,
    current_dir: Path,
    project_dir: Path,
    variables: dict[str, str],
    template_loader: Any,
    step_runner: Any,
    typed_projects: list[tuple[Path, dict[str, Any]]],
) -> AsyncIterator[tuple[str, str]]:
    if isinstance(node, list):
        for item in node:
            if isinstance(item, str):
                target = current_dir / item
                target.mkdir(parents=True, exist_ok=True)
                yield ("ok", f"Created folder: {target.relative_to(project_dir)}")
            elif isinstance(item, dict):
                for name, child in item.items():
                    async for ev in _apply_named_node(
                        name, child, current_dir, project_dir, variables, template_loader, step_runner, typed_projects
                    ):
                        yield ev
        return

    if not isinstance(node, dict):
        return

    for folder_name in node.get("folders", []):
        target = current_dir / folder_name
        target.mkdir(parents=True, exist_ok=True)
        yield ("ok", f"Created folder: {target.relative_to(project_dir)}")

    for template_id in node.get("templates", []):
        async for ev in _apply_structure_template(template_id, current_dir, variables, template_loader, step_runner):
            yield ev

    for key, child in node.items():
        if key in _RESERVED_KEYS:
            continue
        async for ev in _apply_named_node(
            key, child, current_dir, project_dir, variables, template_loader, step_runner, typed_projects
        ):
            yield ev


async def _apply_named_node(
    name: str,
    node: Any,
    parent_dir: Path,
    project_dir: Path,
    variables: dict[str, str],
    template_loader: Any,
    step_runner: Any,
    typed_projects: list[tuple[Path, dict[str, Any]]],
) -> AsyncIterator[tuple[str, str]]:
    from forge.engine.scaffolder import _vars_to_env

    target_dir = parent_dir / name
    node_type = node.get("type") if isinstance(node, dict) else None

    if node_type:
        dotnet_template = _DOTNET_TYPE_MAP.get(node_type)
        if dotnet_template is None and node_type == "unit-test":
            dotnet_template = node.get("lib") or "xunit"
        if dotnet_template is None:
            dotnet_template = node_type  # forward-compatible passthrough

        label = f"dotnet new {dotnet_template} -n {name}"
        yield ("running", label)
        rc = await step_runner(
            f"dotnet new {dotnet_template} -n {name} -o {name}",
            parent_dir, label, _vars_to_env(variables),
        )
        if rc != 0:
            yield ("error", f"{label} failed (exit {rc})")
        else:
            yield ("ok", f"Project created: {target_dir.relative_to(project_dir)}")
        typed_projects.append((target_dir, node))
    else:
        target_dir.mkdir(parents=True, exist_ok=True)
        yield ("ok", f"Created folder: {target_dir.relative_to(project_dir)}")

    if isinstance(node, dict):
        async for ev in _apply_node(node, target_dir, project_dir, variables, template_loader, step_runner, typed_projects):
            yield ev


async def _apply_structure_template(
    template_id: str,
    current_dir: Path,
    variables: dict[str, str],
    template_loader: Any,
    step_runner: Any,
) -> AsyncIterator[tuple[str, str]]:
    """Apply a directory-template at *current_dir* (overriding its own target_dir —
    placement here is dictated by the structure tree, not the template's default)."""
    from forge.engine.scaffolder import _apply_asset_local, _run_commands_interactive, _scaffold_script

    loader = template_loader
    if loader is None:
        from forge.engine.templates_loader import TemplateLoader
        loader = TemplateLoader()

    try:
        asset = loader.get(template_id)
    except KeyError as e:
        yield ("error", str(e))
        return

    asset_cfg = asset.config
    merged_vars: dict[str, str] = {
        v["key"]: str(v.get("default", "")) for v in asset_cfg.get("variables", []) if v.get("key")
    }
    merged_vars.update(variables)

    apply_cfg = asset_cfg.get("apply", {"type": "local"})
    apply_type = apply_cfg.get("type", "local")

    yield ("running", f"Applying template: {asset_cfg.get('name', template_id)} -> {current_dir}")

    if apply_type == "local":
        async for ev in _apply_asset_local(apply_cfg, asset.path, "template", merged_vars, current_dir):
            yield ev
    elif apply_type == "command":
        async for ev in _run_commands_interactive(apply_cfg.get("commands", []), merged_vars, current_dir, step_runner):
            yield ev
    elif apply_type == "script":
        async for ev in _scaffold_script(apply_cfg, asset.path, merged_vars, current_dir, step_runner):
            yield ev
    else:
        yield ("error", f"Unknown template apply type: {apply_type!r}")


async def _finalize_dotnet_solution(
    project_dir: Path,
    variables: dict[str, str],
    step_runner: Any,
    typed_projects: list[tuple[Path, dict[str, Any]]],
) -> AsyncIterator[tuple[str, str]]:
    """Create (if needed) a .sln, add every typed project to it, then wire up references."""
    from forge.engine.scaffolder import _vars_to_env

    env = _vars_to_env(variables)
    project_name = variables.get("project_name", "MyProject")

    existing_sln = list(project_dir.glob("*.sln"))
    sln_stem = existing_sln[0].stem if existing_sln else project_name

    if not existing_sln:
        label = f"Create solution file: {sln_stem}.sln"
        yield ("running", label)
        rc = await step_runner(f"dotnet new sln -n {sln_stem}", project_dir, label, env)
        yield ("ok", label) if rc == 0 else ("error", f"{label} failed (exit {rc})")

    for proj_dir, _node in typed_projects:
        rel = proj_dir.relative_to(project_dir).as_posix()
        proj_file = f"{rel}/{proj_dir.name}.csproj"
        label = f"Add {proj_dir.name} to solution"
        yield ("running", label)
        rc = await step_runner(f"dotnet sln {sln_stem}.sln add {proj_file}", project_dir, label, env)
        yield ("ok", label) if rc == 0 else ("error", f"{label} failed (exit {rc})")

    for proj_dir, node in typed_projects:
        for ref in node.get("references", []):
            proj_file = f"{proj_dir.relative_to(project_dir).as_posix()}/{proj_dir.name}.csproj"
            ref_file = f"{ref}/{ref}.csproj"
            label = f"{proj_dir.name} -> reference {ref}"
            yield ("running", label)
            rc = await step_runner(f"dotnet add {proj_file} reference {ref_file}", project_dir, label, env)
            yield ("ok", label) if rc == 0 else ("error", f"{label} failed (exit {rc})")