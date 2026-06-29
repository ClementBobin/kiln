"""tests/test_scaffolder.py — Unit tests for scaffolder and template_vars."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from forge.engine.template_vars import (
    collect_placeholders,
    interpolate_directory,
    interpolate_string,
    interpolate_file,
    interpolate_path,
)
from forge.engine.scaffolder import preview_tree


# ------------------------------------------------------------------ #
# interpolate_string
# ------------------------------------------------------------------ #

class TestInterpolateString:
    def test_simple_replacement(self) -> None:
        result = interpolate_string("Hello {{name}}!", {"name": "World"})
        assert result == "Hello World!"

    def test_multiple_replacements(self) -> None:
        result = interpolate_string(
            "{{greeting}}, {{name}}! You are {{age}} years old.",
            {"greeting": "Hi", "name": "Alice", "age": "30"},
        )
        assert result == "Hi, Alice! You are 30 years old."

    def test_missing_key_keeps_placeholder(self) -> None:
        result = interpolate_string("Hello {{missing}}!", {})
        assert result == "Hello {{ missing }}!"

    def test_no_placeholders(self) -> None:
        result = interpolate_string("Hello World!", {"name": "X"})
        assert result == "Hello World!"

    def test_whitespace_inside_braces(self) -> None:
        result = interpolate_string("{{ name }}", {"name": "Alice"})
        assert result == "Alice"

    def test_same_key_multiple_times(self) -> None:
        result = interpolate_string("{{x}} + {{x}} = ?", {"x": "1"})
        assert result == "1 + 1 = ?"

    def test_empty_value(self) -> None:
        result = interpolate_string("prefix{{x}}suffix", {"x": ""})
        assert result == "prefixsuffix"


# ------------------------------------------------------------------ #
# interpolate_path
# ------------------------------------------------------------------ #

class TestInterpolatePath:
    def test_path_with_placeholder(self) -> None:
        result = interpolate_path("{{project_name}}.sln", {"project_name": "MyApp"})
        assert result == "MyApp.sln"

    def test_path_no_placeholder(self) -> None:
        result = interpolate_path("README.md", {"project_name": "MyApp"})
        assert result == "README.md"


# ------------------------------------------------------------------ #
# interpolate_file
# ------------------------------------------------------------------ #

class TestInterpolateFile:
    def test_file_content_replaced(self, tmp_path: Path) -> None:
        f = tmp_path / "hello.txt"
        f.write_text("Hello {{name}}!", encoding="utf-8")
        interpolate_file(f, {"name": "Forge"})
        assert f.read_text(encoding="utf-8") == "Hello Forge!"

    def test_binary_file_skipped(self, tmp_path: Path) -> None:
        f = tmp_path / "img.bin"
        f.write_bytes(b"\x00\x01\x02\x03")
        interpolate_file(f, {"name": "X"})  # should not raise
        assert f.read_bytes() == b"\x00\x01\x02\x03"

    def test_unchanged_file_not_rewritten(self, tmp_path: Path, monkeypatch) -> None:
        f = tmp_path / "static.txt"
        content = "No placeholders here."
        f.write_text(content, encoding="utf-8")
        writes = []
        original_write = Path.write_text

        def patched_write(self, data, *args, **kwargs):
            writes.append(self)
            return original_write(self, data, *args, **kwargs)

        monkeypatch.setattr(Path, "write_text", patched_write)
        interpolate_file(f, {"x": "y"})
        assert f not in writes


# ------------------------------------------------------------------ #
# interpolate_directory
# ------------------------------------------------------------------ #

class TestInterpolateDirectory:
    def test_file_content_and_name(self, tmp_path: Path) -> None:
        # Create: {{project_name}}/README.md
        proj_dir = tmp_path / "{{project_name}}"
        proj_dir.mkdir()
        readme = proj_dir / "README.md"
        readme.write_text("# {{project_name}}", encoding="utf-8")

        interpolate_directory(tmp_path, {"project_name": "MyProject"})

        result_dir = tmp_path / "MyProject"
        assert result_dir.exists()
        assert (result_dir / "README.md").read_text(encoding="utf-8") == "# MyProject"

    def test_nested_rename(self, tmp_path: Path) -> None:
        nested = tmp_path / "src" / "{{ns}}" / "{{ns}}.csproj"
        nested.parent.mkdir(parents=True)
        nested.write_text("<Project>{{ns}}</Project>", encoding="utf-8")

        interpolate_directory(tmp_path, {"ns": "Acme"})

        result_file = tmp_path / "src" / "Acme" / "Acme.csproj"
        assert result_file.exists()
        assert "Acme" in result_file.read_text(encoding="utf-8")

    def test_multiple_variables(self, tmp_path: Path) -> None:
        f = tmp_path / "config.txt"
        f.write_text("name={{project_name}}, ns={{namespace}}", encoding="utf-8")
        interpolate_directory(tmp_path, {"project_name": "App", "namespace": "com.app"})
        assert f.read_text(encoding="utf-8") == "name=App, ns=com.app"


# ------------------------------------------------------------------ #
# collect_placeholders
# ------------------------------------------------------------------ #

class TestCollectPlaceholders:
    def test_finds_placeholders_in_content(self, tmp_path: Path) -> None:
        f = tmp_path / "file.txt"
        f.write_text("Hello {{name}}, your {{role}} is ready.", encoding="utf-8")
        keys = collect_placeholders(tmp_path)
        assert "name" in keys
        assert "role" in keys

    def test_finds_placeholders_in_filenames(self, tmp_path: Path) -> None:
        f = tmp_path / "{{project_name}}.sln"
        f.write_text("content", encoding="utf-8")
        keys = collect_placeholders(tmp_path)
        assert "project_name" in keys

    def test_empty_directory(self, tmp_path: Path) -> None:
        keys = collect_placeholders(tmp_path)
        assert keys == set()


# ------------------------------------------------------------------ #
# preview_tree
# ------------------------------------------------------------------ #

class TestPreviewTree:
    def test_local_tree(self, tmp_path: Path) -> None:
        files_dir = tmp_path / "files"
        files_dir.mkdir()
        (files_dir / "README.md").write_text("hello")
        (files_dir / "src").mkdir()
        (files_dir / "src" / "main.py").write_text("pass")

        config = {"source": {"type": "local", "files_dir": "./files"}}
        lines = preview_tree(config, tmp_path)
        assert any("README.md" in line for line in lines)
        assert any("src" in line for line in lines)
        assert any("main.py" in line for line in lines)

    def test_github_tree(self, tmp_path: Path) -> None:
        config = {
            "source": {
                "type": "github",
                "repo": "owner/repo",
                "branch": "main",
                "subfolder": "templates/clean",
            }
        }
        lines = preview_tree(config, tmp_path)
        combined = " ".join(lines)
        assert "owner/repo" in combined
        assert "main" in combined
        assert "templates/clean" in combined

    def test_missing_files_dir(self, tmp_path: Path) -> None:
        config = {"source": {"type": "local", "files_dir": "./nonexistent"}}
        lines = preview_tree(config, tmp_path)
        assert len(lines) == 1
        assert "no local files" in lines[0] or "not found" in lines[0]

    def test_command_source(self, tmp_path: Path) -> None:
        config = {
            "source": {
                "type": "command",
                "commands": [{"cmd": "npm create vite@latest {{project_name}}", "label": "Run Vite"}],
            }
        }
        lines = preview_tree(config, tmp_path)
        combined = " ".join(lines)
        assert "Command" in combined
        assert "npm create vite" in combined

    def test_script_source(self, tmp_path: Path) -> None:
        config = {"source": {"type": "script", "script": "./scaffold.sh", "args": ["{{project_name}}"]}}
        lines = preview_tree(config, tmp_path)
        combined = " ".join(lines)
        assert "Script" in combined
        assert "scaffold.sh" in combined

    def test_multi_step_source(self, tmp_path: Path) -> None:
        files_dir = tmp_path / "files"
        files_dir.mkdir()
        (files_dir / "README.md").write_text("hi")
        config = {
            "source": [
                {"type": "command", "commands": [{"cmd": "echo hi"}]},
                {"type": "local", "files_dir": "./files"},
            ]
        }
        lines = preview_tree(config, tmp_path)
        combined = " ".join(lines)
        assert "[1]" in combined and "[2]" in combined
        assert "README.md" in combined


# ------------------------------------------------------------------ #
# scaffold — command / script source types
# ------------------------------------------------------------------ #

class TestScaffoldCommandAndScript:
    @pytest.mark.asyncio
    async def test_command_source_creates_project(self, tmp_path: Path) -> None:
        from forge.engine.scaffolder import scaffold

        config_dir = tmp_path / "template"
        config_dir.mkdir()
        config = {
            "source": {
                "type": "command",
                "commands": [
                    {"cmd": "mkdir -p {{project_name}} && echo hello > {{project_name}}/marker.txt", "label": "Create"}
                ],
            },
            "git": {"init": False},
            "post_init": [],
        }
        output = tmp_path / "output"
        output.mkdir()

        statuses = []
        async for status, _msg in scaffold(
            config=config,
            config_path=config_dir,
            variables={"project_name": "CmdApp"},
            output_dir=output,
        ):
            statuses.append(status)

        assert "error" not in statuses
        marker = output / "CmdApp" / "marker.txt"
        assert marker.exists()
        assert marker.read_text().strip() == "hello"

    @pytest.mark.asyncio
    async def test_command_source_missing_dir_is_error(self, tmp_path: Path) -> None:
        from forge.engine.scaffolder import scaffold

        config_dir = tmp_path / "template"
        config_dir.mkdir()
        config = {
            "source": {
                "type": "command",
                # Does NOT actually create the project directory.
                "commands": [{"cmd": "echo nothing", "label": "noop"}],
            },
            "git": {"init": False},
            "post_init": [],
        }
        output = tmp_path / "output"
        output.mkdir()

        statuses = []
        async for status, _msg in scaffold(
            config=config,
            config_path=config_dir,
            variables={"project_name": "Ghost"},
            output_dir=output,
        ):
            statuses.append(status)

        assert "error" in statuses

    @pytest.mark.asyncio
    async def test_script_source_runs_with_args_and_env(self, tmp_path: Path) -> None:
        from forge.engine.scaffolder import scaffold

        config_dir = tmp_path / "template"
        config_dir.mkdir()
        script = config_dir / "scaffold.sh"
        script.write_text(
            "#!/usr/bin/env bash\n"
            'mkdir -p "$1"\n'
            'echo "$FORGE_VAR_PORT" > "$1/port.txt"\n',
            encoding="utf-8",
        )

        config = {
            "source": {
                "type": "script",
                "script": "./scaffold.sh",
                "args": ["{{project_name}}"],
            },
            "git": {"init": False},
            "post_init": [],
        }
        output = tmp_path / "output"
        output.mkdir()

        statuses = []
        async for status, _msg in scaffold(
            config=config,
            config_path=config_dir,
            variables={"project_name": "ScriptApp", "port": "4242"},
            output_dir=output,
        ):
            statuses.append(status)

        assert "error" not in statuses
        port_file = output / "ScriptApp" / "port.txt"
        assert port_file.exists()
        assert port_file.read_text().strip() == "4242"

    @pytest.mark.asyncio
    async def test_multi_step_command_then_local(self, tmp_path: Path) -> None:
        """command step creates the dir, local step overlays extra files on top."""
        from forge.engine.scaffolder import scaffold

        config_dir = tmp_path / "template"
        files_dir = config_dir / "files"
        files_dir.mkdir(parents=True)
        (files_dir / "EXTRA.md").write_text("extra", encoding="utf-8")

        config = {
            "source": [
                {
                    "type": "command",
                    "commands": [{"cmd": "mkdir -p {{project_name}}", "label": "Create dir"}],
                },
                {"type": "local", "files_dir": "./files"},
            ],
            "git": {"init": False},
            "post_init": [],
        }
        output = tmp_path / "output"
        output.mkdir()

        statuses = []
        async for status, _msg in scaffold(
            config=config,
            config_path=config_dir,
            variables={"project_name": "ComboApp"},
            output_dir=output,
        ):
            statuses.append(status)

        assert "error" not in statuses
        assert (output / "ComboApp" / "EXTRA.md").exists()


# ------------------------------------------------------------------ #
# scaffold (async, integration-light)
# ------------------------------------------------------------------ #

class TestScaffold:
    @pytest.mark.asyncio
    async def test_local_scaffold_creates_files(self, tmp_path: Path) -> None:
        from forge.engine.scaffolder import scaffold

        # Prepare template
        config_dir = tmp_path / "template"
        files_dir = config_dir / "files"
        files_dir.mkdir(parents=True)
        readme = files_dir / "README.md"
        readme.write_text("# {{project_name}}", encoding="utf-8")

        config = {
            "source": {"type": "local", "files_dir": "./files"},
            "variables": [{"key": "project_name", "label": "Name", "default": "MyApp"}],
            "git": {"init": False},
            "post_init": [],
        }

        output = tmp_path / "output"
        output.mkdir()

        statuses = []
        async for status, msg in scaffold(
            config=config,
            config_path=config_dir,
            variables={"project_name": "AwesomeApp"},
            output_dir=output,
        ):
            statuses.append(status)

        assert "error" not in statuses
        project_dir = output / "AwesomeApp"
        assert project_dir.exists()
        readme_out = project_dir / "README.md"
        assert readme_out.exists()
        assert readme_out.read_text(encoding="utf-8") == "# AwesomeApp"

    @pytest.mark.asyncio
    async def test_duplicate_project_dir_raises_error(self, tmp_path: Path) -> None:
        from forge.engine.scaffolder import scaffold

        config_dir = tmp_path / "template"
        files_dir = config_dir / "files"
        files_dir.mkdir(parents=True)

        config = {
            "source": {"type": "local", "files_dir": "./files"},
            "git": {"init": False},
            "post_init": [],
        }

        output = tmp_path / "output"
        output.mkdir()
        (output / "MyApp").mkdir()  # pre-existing directory

        statuses: list[str] = []
        async for status, _ in scaffold(
            config=config,
            config_path=config_dir,
            variables={"project_name": "MyApp"},
            output_dir=output,
        ):
            statuses.append(status)

        assert "error" in statuses


# ------------------------------------------------------------------ #
# scaffold — always-on git, "extras" (dockerfile/compose/cicd), and
# interactive step_runner injection
# ------------------------------------------------------------------ #

class _RecordingRunner:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Path, str, dict]] = []

    async def __call__(self, cmd: str, cwd: Path, label: str, env: dict) -> int:
        self.calls.append((cmd, cwd, label, env))
        return 0


class TestScaffoldAlwaysGit:
    @pytest.mark.asyncio
    async def test_git_initialized_and_committed_even_without_git_block(self, tmp_path: Path) -> None:
        from forge.engine.scaffolder import scaffold

        config_dir = tmp_path / "template"
        files_dir = config_dir / "files"
        files_dir.mkdir(parents=True)
        (files_dir / "a.txt").write_text("x")

        # Deliberately omit "git" entirely — it must still happen.
        config = {"source": {"type": "local", "files_dir": "./files"}}
        output = tmp_path / "output"
        output.mkdir()

        statuses = []
        async for status, _msg in scaffold(
            config=config, config_path=config_dir,
            variables={"project_name": "GitAlwaysApp"}, output_dir=output,
        ):
            statuses.append(status)

        assert "error" not in statuses
        project_dir = output / "GitAlwaysApp"
        assert (project_dir / ".git").exists()

        log = subprocess_run(["git", "log", "--oneline"], cwd=project_dir)
        assert "chore: initial scaffold via forge" in log


class TestScaffoldExtras:
    @pytest.mark.asyncio
    async def test_no_extras_by_default(self, tmp_path: Path) -> None:
        from forge.engine.scaffolder import scaffold

        config_dir = tmp_path / "template"
        files_dir = config_dir / "files"
        files_dir.mkdir(parents=True)
        (files_dir / "a.txt").write_text("x")
        config = {"source": {"type": "local", "files_dir": "./files"}}
        output = tmp_path / "output"
        output.mkdir()

        async for _ in scaffold(config, config_dir, {"project_name": "NoExtras"}, output):
            pass

        project_dir = output / "NoExtras"
        assert not (project_dir / "Dockerfile").exists()
        assert not (project_dir / "docker-compose.yml").exists()
        assert not (project_dir / ".github").exists()

    @pytest.mark.asyncio
    async def test_dockerfile_and_compose_created_when_requested(self, tmp_path: Path) -> None:
        from forge.engine.scaffolder import scaffold

        config_dir = tmp_path / "template"
        files_dir = config_dir / "files"
        files_dir.mkdir(parents=True)
        (files_dir / "a.txt").write_text("x")
        config = {"stack": "nodejs", "source": {"type": "local", "files_dir": "./files"}}
        output = tmp_path / "output"
        output.mkdir()

        variables = {
            "project_name": "WithExtras",
            "forge_dockerfile": "true",
            "forge_docker_compose": "true",
            "forge_pipeline": "none",  # skip build/test/format — no package.json here
        }
        statuses = []
        async for status, _msg in scaffold(config, config_dir, variables, output):
            statuses.append(status)

        assert "error" not in statuses
        project_dir = output / "WithExtras"
        assert "node:" in (project_dir / "Dockerfile").read_text()
        assert "WithExtras" in (project_dir / "docker-compose.yml").read_text()

    @pytest.mark.asyncio
    async def test_cicd_workflow_created_for_dotnet_stack(self, tmp_path: Path) -> None:
        from forge.engine.scaffolder import scaffold

        config_dir = tmp_path / "template"
        files_dir = config_dir / "files"
        files_dir.mkdir(parents=True)
        (files_dir / "a.txt").write_text("x")
        config = {"stack": "dotnet", "source": {"type": "local", "files_dir": "./files"}}
        output = tmp_path / "output"
        output.mkdir()

        variables = {
            "project_name": "CiApp",
            "forge_cicd": "true",
            "forge_cicd_provider": "github-actions",
            "forge_pipeline": "test",
        }
        async for _ in scaffold(config, config_dir, variables, output, step_runner=_RecordingRunner()):
            pass

        workflow = output / "CiApp" / ".github" / "workflows" / "ci.yml"
        assert workflow.exists()
        content = workflow.read_text()
        assert "dotnet test" in content
        assert "dotnet build" not in content  # pipeline reduced to just "test"


class TestScaffoldStepRunnerInjection:
    @pytest.mark.asyncio
    async def test_command_source_step_uses_injected_runner(self, tmp_path: Path) -> None:
        from forge.engine.scaffolder import scaffold

        config_dir = tmp_path / "template"
        config_dir.mkdir()
        config = {
            "source": {
                "type": "command",
                "commands": [{"cmd": "mkdir -p {{project_name}}", "label": "Create"}],
            },
        }
        output = tmp_path / "output"
        output.mkdir()
        runner = _RecordingRunner()

        async for _ in scaffold(
            config, config_dir, {"project_name": "RunnerApp"}, output, step_runner=runner
        ):
            pass

        assert any("mkdir -p RunnerApp" in call[0] for call in runner.calls)

    @pytest.mark.asyncio
    async def test_post_init_and_pipeline_use_injected_runner(self, tmp_path: Path) -> None:
        from forge.engine.scaffolder import scaffold

        config_dir = tmp_path / "template"
        files_dir = config_dir / "files"
        files_dir.mkdir(parents=True)
        (files_dir / "a.txt").write_text("x")
        config = {
            "stack": "nodejs",
            "source": {"type": "local", "files_dir": "./files"},
            "post_init": [{"cmd": "echo from-post-init", "label": "Post"}],
        }
        output = tmp_path / "output"
        output.mkdir()
        runner = _RecordingRunner()

        async for _ in scaffold(
            config, config_dir,
            {"project_name": "PipelineApp", "forge_pipeline": "build"},
            output, step_runner=runner,
        ):
            pass

        all_cmds = [c[0] for c in runner.calls]
        assert "echo from-post-init" in all_cmds
        assert any("npm run build" in c for c in all_cmds)


def subprocess_run(args: list[str], cwd: Path) -> str:
    import subprocess
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    return result.stdout
