"""forge/engine/constructors/dotnet.py — .NET stack constructor."""

from __future__ import annotations

from forge.engine.constructors.base import StackConstructor


class DotnetConstructor(StackConstructor):
    stack_id = "dotnet"

    def dockerfile(self, variables: dict[str, str]) -> str:
        dotnet_version = variables.get("dotnet_version", "8")
        project_name = variables.get("project_name", "App")
        return f"""FROM mcr.microsoft.com/dotnet/sdk:{dotnet_version}.0 AS build
WORKDIR /src
COPY . .
RUN dotnet restore
RUN dotnet publish -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:{dotnet_version}.0 AS final
WORKDIR /app
COPY --from=build /app .
ENTRYPOINT ["dotnet", "{project_name}.dll"]
"""

    def docker_compose(self, variables: dict[str, str]) -> str:
        project = variables.get("project_name", "app")
        port = variables.get("port", "8080")
        return f"""services:
  {project}:
    build: .
    ports:
      - "{port}:8080"
    environment:
      - ASPNETCORE_ENVIRONMENT=Development
"""

    def ci_workflow(
        self, provider: str, pipeline: list[str], variables: dict[str, str]
    ) -> dict[str, str]:
        if provider != "github-actions":
            return {}

        steps = []
        if "build" in pipeline:
            steps.append("      - run: dotnet build --no-restore")
        if "test" in pipeline:
            steps.append("      - run: dotnet test --no-build")
        if "format" in pipeline:
            steps.append("      - run: dotnet format --verify-no-changes")
        body = "\n".join(steps) if steps else "      - run: echo no-op"

        dotnet_version = variables.get("dotnet_version", "8")
        yaml = f"""name: CI
on: [push, pull_request]
jobs:
  pipeline:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: "{dotnet_version}.0"
      - run: dotnet restore
{body}
"""
        return {".github/workflows/ci.yml": yaml}

    def pipeline_commands(
        self, pipeline: list[str], variables: dict[str, str]
    ) -> list[dict[str, str]]:
        commands = []
        if "build" in pipeline:
            commands.append({"cmd": "dotnet build", "label": "Build"})
        if "test" in pipeline:
            commands.append({"cmd": "dotnet test", "label": "Test"})
        if "format" in pipeline:
            commands.append({"cmd": "dotnet format", "label": "Format"})
        return commands
