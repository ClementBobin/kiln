"""forge/engine/constructors/nodejs.py — Node.js / React stack constructor."""

from __future__ import annotations

from forge.engine.constructors.base import StackConstructor


class NodejsConstructor(StackConstructor):
    stack_id = "nodejs"

    def dockerfile(self, variables: dict[str, str]) -> str:
        node_version = variables.get("node_version", "20")
        return f"""FROM node:{node_version}-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build --if-present
EXPOSE 3000
CMD ["npm", "start"]
"""

    def docker_compose(self, variables: dict[str, str]) -> str:
        project = variables.get("project_name", "app")
        port = variables.get("port", "3000")
        return f"""services:
  {project}:
    build: .
    ports:
      - "{port}:{port}"
    env_file: .env
"""

    def ci_workflow(
        self, provider: str, pipeline: list[str], variables: dict[str, str]
    ) -> dict[str, str]:
        if provider != "github-actions":
            return {}

        steps = []
        if "build" in pipeline:
            steps.append("      - run: npm run build --if-present")
        if "test" in pipeline:
            steps.append("      - run: npm test --if-present")
        if "format" in pipeline:
            steps.append("      - run: npm run format:check --if-present")
        body = "\n".join(steps) if steps else "      - run: echo no-op"

        node_version = variables.get("node_version", "20")
        yaml = f"""name: CI
on: [push, pull_request]
jobs:
  pipeline:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "{node_version}"
      - run: npm ci
{body}
"""
        return {".github/workflows/ci.yml": yaml}

    def pipeline_commands(
        self, pipeline: list[str], variables: dict[str, str]
    ) -> list[dict[str, str]]:
        commands = []
        if "build" in pipeline:
            commands.append({"cmd": "npm run build --if-present", "label": "Build"})
        if "test" in pipeline:
            commands.append({"cmd": "npm test --if-present", "label": "Test"})
        if "format" in pipeline:
            commands.append({"cmd": "npm run format --if-present", "label": "Format"})
        return commands
