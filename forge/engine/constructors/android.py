from __future__ import annotations

from forge.engine.constructors.base import StackConstructor


class AndroidConstructor(StackConstructor):
    stack_id = "android"

    def dockerfile(self, variables: dict[str, str]) -> str:
        return """# Android projects are normally built outside Docker.
FROM eclipse-temurin:21-jdk
WORKDIR /app
COPY . .
RUN chmod +x gradlew || true
CMD ["./gradlew", "assembleDebug"]
"""

    def docker_compose(self, variables: dict[str, str]) -> str:
        project = variables.get("project_name", "android")
        return f"""services:
  {project}:
    build: .
"""

    def ci_workflow(
        self,
        provider: str,
        pipeline: list[str],
        variables: dict[str, str],
    ) -> dict[str, str]:

        if provider != "github-actions":
            return {}

        steps = []

        if "build" in pipeline:
            steps.append("      - run: ./gradlew assemble")

        if "test" in pipeline:
            steps.append("      - run: ./gradlew test")

        if "format" in pipeline:
            steps.append("      - run: ./gradlew ktlintCheck")

        body = "\n".join(steps) if steps else "      - run: echo no-op"

        yaml = f"""name: Android CI

on:
  push:
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 21

      - uses: gradle/actions/setup-gradle@v4

      - run: chmod +x gradlew

{body}
"""

        return {
            ".github/workflows/ci.yml": yaml
        }

    def pipeline_commands(
        self,
        pipeline: list[str],
        variables: dict[str, str],
    ) -> list[dict[str, str]]:

        commands = []

        if "build" in pipeline:
            commands.append({
                "cmd": "./gradlew assemble",
                "label": "Build",
            })

        if "test" in pipeline:
            commands.append({
                "cmd": "./gradlew test",
                "label": "Test",
            })

        if "format" in pipeline:
            commands.append({
                "cmd": "./gradlew ktlintCheck",
                "label": "Format",
            })

        return commands