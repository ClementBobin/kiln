"""forge/engine/constructors — Per-tech-stack "constructors".

A constructor knows how to materialize the cross-cutting, tech-specific
parts of a project that are NOT declared per-template in config.json:
Dockerfile, docker-compose.yml, CI/CD workflow files, and the
build/test/format pipeline commands. These are offered uniformly for every
project (see scaffolder.py's "always present" variables), and dispatched
here to whichever constructor matches the config's stack.

Add a new stack by dropping a module here (e.g. ``android.py``) with a
``StackConstructor`` subclass, then registering it in ``_REGISTRY`` below.
"""

from __future__ import annotations

from typing import Any

from forge.engine.constructors.base import StackConstructor
from forge.engine.constructors.dotnet import DotnetConstructor
from forge.engine.constructors.nodejs import NodejsConstructor

_GENERIC = StackConstructor()

_REGISTRY: dict[str, StackConstructor] = {
    "nodejs": NodejsConstructor(),
    "react": NodejsConstructor(),   # react/vite/next projects are npm-based
    "dotnet": DotnetConstructor(),
}


def register_constructor(stack_id: str, constructor: StackConstructor) -> None:
    """Register (or override) the constructor used for a given stack id."""
    _REGISTRY[stack_id] = constructor


def get_constructor(config: dict[str, Any]) -> StackConstructor:
    """Resolve the constructor to use for *config*.

    Priority: explicit top-level ``"stack"`` field, then the first matching
    tag in ``"tags"``, then a no-op generic fallback.
    """
    stack = config.get("stack")
    if stack and stack in _REGISTRY:
        return _REGISTRY[stack]
    for tag in config.get("tags", []):
        if tag in _REGISTRY:
            return _REGISTRY[tag]
    return _GENERIC
