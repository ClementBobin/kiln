"""forge/engine/template_vars.py — Jinja2-like variable interpolation in files."""

from __future__ import annotations

import re
from pathlib import Path

# Matches {{variable_name}} placeholders
_PLACEHOLDER_RE = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")


def interpolate_string(text: str, variables: dict[str, str]) -> str:
    """Replace all {{key}} placeholders in *text* with values from *variables*."""

    def replacer(match: re.Match) -> str:
        key = match.group(1)
        return variables.get(key, match.group(0))  # keep original if key missing

    return _PLACEHOLDER_RE.sub(replacer, text)


def interpolate_path(path_str: str, variables: dict[str, str]) -> str:
    """Interpolate placeholders in a file/directory path string."""
    return interpolate_string(path_str, variables)


def interpolate_file(file_path: Path, variables: dict[str, str]) -> None:
    """
    Read *file_path*, replace all {{key}} placeholders in-place, write back.
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
    Scan all files in *template_dir* and collect all unique placeholder keys.
    Useful for pre-validating variables before scaffolding.
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
