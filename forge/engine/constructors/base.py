"""forge/engine/constructors/base.py — Base class for tech-specific constructors."""

from __future__ import annotations

from typing import Any


class StackConstructor:
    """Knows how to build the cross-cutting, tech-specific parts of a project.

    The generic base implementation is a sane, harmless fallback for unknown
    stacks: a minimal Dockerfile/compose file and no CI/CD or pipeline
    commands (since it has no idea what build tool to call).
    """

    stack_id = "generic"

    def dockerfile(self, variables: dict[str, str]) -> str:
        return (
            "# Generic Dockerfile — replace with a stack-specific one.\n"
            "FROM alpine:3.20\n"
            "WORKDIR /app\n"
            "COPY . .\n"
            'CMD ["true"]\n'
        )

    def docker_compose(self, variables: dict[str, str]) -> str:
        project = variables.get("project_name", "app")
        return f"services:\n  {project}:\n    build: .\n"

    def ci_workflow(
        self, provider: str, pipeline: list[str], variables: dict[str, str]
    ) -> dict[str, str]:
        """Return {relative_path: file_content} for the CI/CD workflow(s).

        Returns an empty dict if this constructor/provider combination isn't
        supported — callers should surface that as an informational message,
        not an error.
        """
        return {}

    def pipeline_commands(
        self, pipeline: list[str], variables: dict[str, str]
    ) -> list[dict[str, str]]:
        """Return [{"cmd": ..., "label": ...}, ...] implementing the requested
        pipeline steps (build/test/format/...) for local execution."""
        return []
