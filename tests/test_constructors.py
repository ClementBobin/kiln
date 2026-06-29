"""tests/test_constructors.py — Stack constructor registry and output."""

from __future__ import annotations

from forge.engine.constructors import get_constructor, register_constructor
from forge.engine.constructors.base import StackConstructor
from forge.engine.constructors.dotnet import DotnetConstructor
from forge.engine.constructors.nodejs import NodejsConstructor


class TestDispatch:
    def test_explicit_stack_field_wins(self) -> None:
        c = get_constructor({"stack": "dotnet", "tags": ["nodejs"]})
        assert isinstance(c, DotnetConstructor)

    def test_falls_back_to_tags(self) -> None:
        c = get_constructor({"tags": ["react", "vite"]})
        assert isinstance(c, NodejsConstructor)

    def test_unknown_stack_is_generic(self) -> None:
        c = get_constructor({"tags": ["android", "kotlin"]})
        assert type(c) is StackConstructor

    def test_register_new_constructor(self) -> None:
        class FakeConstructor(StackConstructor):
            stack_id = "fake-stack-for-test"

        register_constructor("fake-stack-for-test", FakeConstructor())
        c = get_constructor({"stack": "fake-stack-for-test"})
        assert isinstance(c, FakeConstructor)


class TestNodejsConstructor:
    def setup_method(self) -> None:
        self.c = NodejsConstructor()

    def test_dockerfile_mentions_node(self) -> None:
        out = self.c.dockerfile({"node_version": "22"})
        assert "node:22-alpine" in out

    def test_docker_compose_uses_project_and_port(self) -> None:
        out = self.c.docker_compose({"project_name": "myapp", "port": "4000"})
        assert "myapp" in out
        assert "4000" in out

    def test_ci_workflow_respects_pipeline(self) -> None:
        files = self.c.ci_workflow("github-actions", ["test"], {})
        content = files[".github/workflows/ci.yml"]
        assert "npm test" in content
        assert "npm run build" not in content

    def test_ci_workflow_unsupported_provider_returns_empty(self) -> None:
        assert self.c.ci_workflow("gitlab-ci", ["build"], {}) == {}

    def test_pipeline_commands_filtered(self) -> None:
        cmds = self.c.pipeline_commands(["format"], {})
        assert len(cmds) == 1
        assert "format" in cmds[0]["cmd"]


class TestDotnetConstructor:
    def setup_method(self) -> None:
        self.c = DotnetConstructor()

    def test_dockerfile_uses_dotnet_version_and_project_name(self) -> None:
        out = self.c.dockerfile({"dotnet_version": "9", "project_name": "MyApi"})
        assert "sdk:9.0" in out
        assert "MyApi.dll" in out

    def test_pipeline_commands_build_test_format(self) -> None:
        cmds = self.c.pipeline_commands(["build", "test", "format"], {})
        joined = " ".join(c["cmd"] for c in cmds)
        assert "dotnet build" in joined
        assert "dotnet test" in joined
        assert "dotnet format" in joined


class TestGenericConstructor:
    def test_ci_workflow_empty_by_default(self) -> None:
        c = StackConstructor()
        assert c.ci_workflow("github-actions", ["build"], {}) == {}

    def test_pipeline_commands_empty_by_default(self) -> None:
        c = StackConstructor()
        assert c.pipeline_commands(["build"], {}) == []
