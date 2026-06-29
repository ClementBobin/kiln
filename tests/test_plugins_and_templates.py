"""tests/test_plugins_and_templates.py — apply_plugins / apply_templates / step_runner."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from forge.engine.asset_loader import RecursiveAssetLoader
from forge.engine.scaffolder import apply_plugins, apply_templates


def _make_loader(tmp_path: Path, manifest_name: str, asset_id: str, config: dict) -> RecursiveAssetLoader:
    root = tmp_path / f"{manifest_name}_root"
    asset_dir = root / asset_id
    asset_dir.mkdir(parents=True)
    (asset_dir / f"{manifest_name}.json").write_text(json.dumps(config))
    return RecursiveAssetLoader(manifest_name, root)


class FakeRunner:
    """Records every command it was asked to run, always succeeds."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, Path, str, dict]] = []

    async def __call__(self, cmd: str, cwd: Path, label: str, env: dict) -> int:
        self.calls.append((cmd, cwd, label, env))
        return 0


class FailingRunner:
    async def __call__(self, cmd: str, cwd: Path, label: str, env: dict) -> int:
        return 1


@pytest.mark.asyncio
class TestApplyPlugins:
    async def test_local_plugin_copies_and_interpolates(self, tmp_path: Path) -> None:
        loader = _make_loader(
            tmp_path, "plugin", "my-plugin",
            {"name": "My Plugin", "apply": {"type": "local"}},
        )
        # the plugin's own payload file, alongside its manifest
        (loader._roots[0] / "my-plugin" / "Hello.cs").write_text("Hello {{project_name}}")

        project_dir = tmp_path / "project"
        project_dir.mkdir()

        statuses = []
        async for status, _msg in apply_plugins(
            {"plugins": ["my-plugin"]}, {"project_name": "Foo"}, project_dir, loader, FakeRunner()
        ):
            statuses.append(status)

        assert "error" not in statuses
        assert (project_dir / "Hello.cs").read_text() == "Hello Foo"

    async def test_target_dir_override(self, tmp_path: Path) -> None:
        loader = _make_loader(
            tmp_path, "plugin", "my-plugin",
            {"name": "My Plugin", "target_dir": ".", "apply": {"type": "local"}},
        )
        (loader._roots[0] / "my-plugin" / "Hello.cs").write_text("x")

        project_dir = tmp_path / "project"
        project_dir.mkdir()

        async for _ in apply_plugins(
            {"plugins": [{"id": "my-plugin", "target_dir": "src/nested"}]},
            {"project_name": "Foo"}, project_dir, loader, FakeRunner(),
        ):
            pass

        assert (project_dir / "src" / "nested" / "Hello.cs").exists()

    async def test_unknown_plugin_yields_error_but_continues(self, tmp_path: Path) -> None:
        loader = RecursiveAssetLoader("plugin", tmp_path / "empty_root")
        project_dir = tmp_path / "project"
        project_dir.mkdir()

        statuses = []
        async for status, msg in apply_plugins(
            {"plugins": ["does-not-exist"]}, {}, project_dir, loader, FakeRunner()
        ):
            statuses.append((status, msg))

        assert any(s == "error" for s, _ in statuses)

    async def test_command_apply_uses_step_runner(self, tmp_path: Path) -> None:
        loader = _make_loader(
            tmp_path, "plugin", "cmd-plugin",
            {
                "name": "Cmd Plugin",
                "apply": {"type": "command", "commands": [{"cmd": "echo {{x}}", "label": "Echo"}]},
            },
        )
        project_dir = tmp_path / "project"
        project_dir.mkdir()
        runner = FakeRunner()

        async for _ in apply_plugins({"plugins": ["cmd-plugin"]}, {"x": "hi"}, project_dir, loader, runner):
            pass

        assert len(runner.calls) == 1
        assert runner.calls[0][0] == "echo hi"
        assert runner.calls[0][1] == project_dir

    async def test_variable_merge_order(self, tmp_path: Path) -> None:
        """plugin defaults < project variables < per-reference overrides."""
        loader = _make_loader(
            tmp_path, "plugin", "var-plugin",
            {
                "name": "Var Plugin",
                "variables": [{"key": "seuil_ms", "default": "200"}],
                "apply": {"type": "local"},
            },
        )
        (loader._roots[0] / "var-plugin" / "Config.cs").write_text("seuil={{seuil_ms}}")
        project_dir = tmp_path / "project"
        project_dir.mkdir()

        # No override: project variables don't define seuil_ms -> plugin default used
        async for _ in apply_plugins({"plugins": ["var-plugin"]}, {}, project_dir, loader, FakeRunner()):
            pass
        assert (project_dir / "Config.cs").read_text() == "seuil=200"

        # Per-reference override wins
        for f in project_dir.glob("*"):
            f.unlink()
        async for _ in apply_plugins(
            {"plugins": [{"id": "var-plugin", "variables": {"seuil_ms": "500"}}]},
            {}, project_dir, loader, FakeRunner(),
        ):
            pass
        assert (project_dir / "Config.cs").read_text() == "seuil=500"

    async def test_post_apply_runs_after_local_copy(self, tmp_path: Path) -> None:
        loader = _make_loader(
            tmp_path, "plugin", "post-plugin",
            {
                "name": "Post Plugin",
                "apply": {"type": "local"},
                "post_apply": [{"cmd": "dotnet add package Foo", "label": "Add Foo"}],
            },
        )
        (loader._roots[0] / "post-plugin" / "X.cs").write_text("x")
        project_dir = tmp_path / "project"
        project_dir.mkdir()
        runner = FakeRunner()

        async for _ in apply_plugins({"plugins": ["post-plugin"]}, {}, project_dir, loader, runner):
            pass

        assert len(runner.calls) == 1
        assert "dotnet add package Foo" in runner.calls[0][0]

    async def test_failing_command_reported_but_does_not_raise(self, tmp_path: Path) -> None:
        loader = _make_loader(
            tmp_path, "plugin", "bad-plugin",
            {"name": "Bad", "apply": {"type": "command", "commands": [{"cmd": "false", "label": "Fail"}]}},
        )
        project_dir = tmp_path / "project"
        project_dir.mkdir()

        statuses = []
        async for status, _msg in apply_plugins(
            {"plugins": ["bad-plugin"]}, {}, project_dir, loader, FailingRunner()
        ):
            statuses.append(status)

        assert "error" in statuses


@pytest.mark.asyncio
class TestApplyTemplates:
    async def test_template_default_target_dir(self, tmp_path: Path) -> None:
        loader = _make_loader(
            tmp_path, "template", "react/structure",
            {"name": "React Structure", "target_dir": "src", "apply": {"type": "local"}},
        )
        (loader._roots[0] / "react" / "structure" / "hooks").mkdir(parents=True)
        (loader._roots[0] / "react" / "structure" / "hooks" / "useX.ts").write_text("export {}")

        project_dir = tmp_path / "project"
        project_dir.mkdir()

        async for _ in apply_templates({"templates": ["react/structure"]}, {}, project_dir, loader, FakeRunner()):
            pass

        assert (project_dir / "src" / "hooks" / "useX.ts").exists()

    async def test_real_builtin_react_structure_template(self, tmp_path: Path) -> None:
        """Smoke-test against the actual shipped react/structure template."""
        from forge.engine.templates_loader import TemplateLoader

        loader = TemplateLoader()
        project_dir = tmp_path / "project"
        project_dir.mkdir()

        statuses = []
        async for status, _msg in apply_templates(
            {"templates": ["react/structure"]}, {}, project_dir, loader, FakeRunner()
        ):
            statuses.append(status)

        assert "error" not in statuses
        assert (project_dir / "src" / "hooks" / "useExample.ts").exists()
        assert (project_dir / "src" / "components" / "ui" / "Button.tsx").exists()
        assert (project_dir / "src" / "contexts" / "AppContext.tsx").exists()
