"""forge/engine/template_vars.py — Variable interpolation in files (Jinja2-powered).

Backward compatible with simple ``{{key}}`` placeholders, but since this is now
real Jinja2 under the hood, plugin/template authors can also use ``{% for %}``
/ ``{% if %}`` blocks when a snippet needs to scale with a variable — e.g. the
built-in EF Core plugin uses a loop to generate N database registrations from
a single ``database_count`` variable.

Unknown variables render back as their original ``{{ name }}`` text (via
``KeepUndefined``) instead of silently becoming empty, matching the previous
regex-based behaviour and making missing variables easy to spot in output.
"""

from __future__ import annotations

import re
from pathlib import Path

import jinja2

# Matches simple {{variable_name}} placeholders (used for path/name interpolation,
# and for placeholder discovery — Jinja2 handles the actual file-content rendering).
_PLACEHOLDER_RE = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")


class KeepUndefined(jinja2.Undefined):
    """An Undefined that renders back to its original {{ name }} text.

    This preserves the old regex-based behaviour of leaving unknown
    placeholders untouched, instead of Jinja2's default of turning them
    into an empty string.
    """

    def __str__(self) -> str:
        return f"{{{{ {self._undefined_name} }}}}" if self._undefined_name else ""

    __repr__ = __str__


_ENV = jinja2.Environment(
    undefined=KeepUndefined,
    trim_blocks=True,
    lstrip_blocks=True,
    keep_trailing_newline=True,
    autoescape=False,
)


def interpolate_string(text: str, variables: dict[str, str]) -> str:
    """Render *text* as a Jinja2 template against *variables*.

    Supports plain ``{{key}}`` substitution as well as ``{% for %}`` / ``{% if %}``
    blocks. Falls back to returning *text* unchanged if it isn't valid Jinja2
    (e.g. stray ``{%`` in a file that isn't meant to be templated).
    """
    try:
        template = _ENV.from_string(text)
        return template.render(**variables)
    except jinja2.TemplateError:
        return text


def interpolate_path(path_str: str, variables: dict[str, str]) -> str:
    """Interpolate placeholders in a file/directory path string."""
    return interpolate_string(path_str, variables)


def interpolate_file(file_path: Path, variables: dict[str, str]) -> None:
    """
    Read *file_path*, render it as a Jinja2 template against *variables*, write back.
    Skips binary files silently.
    """
    try:
        content = file_path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, PermissionError):
        return  # skip binary or unreadable files

    new_content = interpolate_string(content, variables)
    if new_content != content:
        file_path.write_text(new_content, encoding="utf-8")


def interpolate_directory(directory: Path, variables: dict[str, str]) -> None:
    """
    Walk *directory* recursively:
    1. Interpolate file *contents*.
    2. Rename files/directories whose names contain placeholders.
    Renames are done bottom-up to avoid path invalidation.
    """
    # Phase 1 — interpolate file contents
    for file_path in list(directory.rglob("*")):
        if file_path.is_file():
            interpolate_file(file_path, variables)

    # Phase 2 — rename paths bottom-up (deepest first)
    all_paths = sorted(directory.rglob("*"), key=lambda p: len(p.parts), reverse=True)
    for old_path in all_paths:
        new_name = interpolate_path(old_path.name, variables)
        if new_name != old_path.name:
            new_path = old_path.parent / new_name
            old_path.rename(new_path)


def collect_placeholders(template_dir: Path) -> set[str]:
    """
    Scan all files in *template_dir* and collect all unique simple ``{{key}}``
    placeholder keys (path components and file content). Useful for
    pre-validating variables before scaffolding. Does not attempt to parse
    {% %} block variables — those are considered advanced/plugin-internal.
    """
    keys: set[str] = set()
    for file_path in template_dir.rglob("*"):
        # Check path components
        for part in file_path.parts:
            for m in _PLACEHOLDER_RE.finditer(part):
                keys.add(m.group(1))
        # Check file content
        if file_path.is_file():
            try:
                content = file_path.read_text(encoding="utf-8")
                for m in _PLACEHOLDER_RE.finditer(content):
                    keys.add(m.group(1))
            except (UnicodeDecodeError, PermissionError):
                pass
    return keys
