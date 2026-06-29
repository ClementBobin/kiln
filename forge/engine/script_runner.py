"""forge/engine/script_runner.py — Cross-platform script execution helper.

Used by source ``"script"`` steps and plugin/template ``apply`` steps to turn
a script file into a runnable shell command, regardless of extension or OS:

  - ``.sh``           — run via bash. On Windows, plain ``git`` does not always
                         put ``bash`` on PATH, so we fall back to locating Git
                         Bash relative to the resolved ``git`` executable
                         (Git for Windows always ships one, since git itself
                         is already a hard requirement of forge). This is the
                         "run with git bash" path.
  - ``.ps1``           — run via ``powershell -File``.
  - ``.cmd`` / ``.bat`` — run via ``cmd /c`` (Windows only).
  - anything else      — executed directly (chmod +x first on POSIX).
"""

from __future__ import annotations

import platform
import shlex
import shutil
import stat
from pathlib import Path


class ScriptRunnerError(Exception):
    """Raised when a script can't be resolved or run on the current platform."""


def find_bash() -> str | None:
    """Best-effort lookup of a usable bash, including Git Bash on Windows."""
    bash = shutil.which("bash")
    if bash:
        return bash

    if platform.system() != "Windows":
        return None

    git_exe = shutil.which("git")
    if not git_exe:
        return None

    git_path = Path(git_exe).resolve()
    # Typical Git for Windows layouts:
    #   .../Git/cmd/git.exe  -> .../Git/bin/bash.exe or .../Git/usr/bin/bash.exe
    #   .../Git/bin/git.exe  -> .../Git/bin/bash.exe
    candidates = [
        git_path.parent.parent / "bin" / "bash.exe",
        git_path.parent.parent / "usr" / "bin" / "bash.exe",
        git_path.parent / "bash.exe",
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


def build_script_command(script_path: Path, args: list[str]) -> list[str]:
    """Return the argv list needed to run *script_path* with *args*.

    Raises ScriptRunnerError if the script's type can't be run on this OS
    (e.g. a .cmd file on Linux) or a required interpreter is missing.
    """
    suffix = script_path.suffix.lower()
    is_windows = platform.system() == "Windows"

    if suffix == ".sh":
        bash = find_bash()
        if not bash:
            raise ScriptRunnerError(
                f"No bash executable found to run {script_path.name}. "
                "On Windows, install Git for Windows (ships with Git Bash) "
                "or add bash to PATH; on Linux/macOS, install bash."
            )
        return [bash, str(script_path), *args]

    if suffix == ".ps1":
        return [
            "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
            "-File", str(script_path), *args,
        ]

    if suffix in (".cmd", ".bat"):
        if not is_windows:
            raise ScriptRunnerError(
                f"{suffix} scripts can only run on Windows: {script_path.name}"
            )
        return ["cmd", "/c", str(script_path), *args]

    # No recognized extension — try to execute the file directly.
    if not is_windows:
        try:
            script_path.chmod(script_path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        except OSError:
            pass
    return [str(script_path), *args]


def quote_command(parts: list[str]) -> str:
    """Join argv *parts* into a single shell command string for the current OS."""
    if platform.system() == "Windows":
        def _quote(p: str) -> str:
            return f'"{p}"' if (" " in p or p == "") else p
        return " ".join(_quote(p) for p in parts)
    return " ".join(shlex.quote(p) for p in parts)
