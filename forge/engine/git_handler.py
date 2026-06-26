"""forge/engine/git_handler.py — Git operations: init, clone, commit."""

from __future__ import annotations

import asyncio
import shutil
import tempfile
from pathlib import Path
from typing import AsyncIterator


class GitError(Exception):
    """Raised when a git operation fails."""


async def _run(
    *args: str,
    cwd: Path | None = None,
) -> tuple[int, str, str]:
    """Run a subprocess asynchronously, return (returncode, stdout, stderr)."""
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=str(cwd) if cwd else None,
    )
    stdout, stderr = await proc.communicate()
    return proc.returncode, stdout.decode(errors="replace"), stderr.decode(errors="replace")


async def ensure_git() -> None:
    """Raise GitError if git is not available in PATH."""
    if shutil.which("git") is None:
        raise GitError(
            "git executable not found in PATH.\n"
            "Install git and make sure it is accessible before running forge."
        )


async def git_init(directory: Path, initial_branch: str = "main") -> None:
    """Initialise a new git repository in *directory*."""
    await ensure_git()
    code, _, err = await _run("git", "init", "-b", initial_branch, cwd=directory)
    if code != 0:
        # Fallback for older git versions that don't support -b
        code2, _, err2 = await _run("git", "init", cwd=directory)
        if code2 != 0:
            raise GitError(f"git init failed: {err2 or err}")
        # Rename branch manually
        await _run("git", "checkout", "-b", initial_branch, cwd=directory)


async def git_add_all(directory: Path) -> None:
    """Stage all files in *directory*."""
    code, _, err = await _run("git", "add", ".", cwd=directory)
    if code != 0:
        raise GitError(f"git add failed: {err}")


async def git_commit(directory: Path, message: str) -> None:
    """Create an initial commit with *message*."""
    # Set a throwaway identity if none configured (avoids error in CI)
    env_patch = {
        "GIT_AUTHOR_NAME": "forge",
        "GIT_AUTHOR_EMAIL": "forge@local",
        "GIT_COMMITTER_NAME": "forge",
        "GIT_COMMITTER_EMAIL": "forge@local",
    }
    import os
    env = {**os.environ, **env_patch}

    proc = await asyncio.create_subprocess_exec(
        "git", "commit", "-m", message,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=str(directory),
        env=env,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise GitError(f"git commit failed: {stderr.decode(errors='replace')}")


async def clone_repo(
    repo: str,
    dest: Path,
    branch: str | None = None,
    subfolder: str | None = None,
) -> AsyncIterator[str]:
    """
    Clone *repo* (format: owner/repo) into *dest*.

    Tries SSH first, falls back to HTTPS.
    Yields progress log lines as strings.
    """
    await ensure_git()

    ssh_url = f"git@github.com:{repo}.git"
    https_url = f"https://github.com/{repo}.git"

    base_args = ["git", "clone", "--depth=1"]
    if branch:
        base_args += ["--branch", branch]

    # Try SSH first
    tried_ssh = False
    for url in [ssh_url, https_url]:
        if url == ssh_url:
            tried_ssh = True
        label = "SSH" if url == ssh_url else "HTTPS"
        yield f"Cloning via {label}: {url}"

        if subfolder:
            # Use sparse checkout for efficiency
            dest.mkdir(parents=True, exist_ok=True)
            args = [
                "git", "clone", "--depth=1", "--filter=blob:none",
                "--sparse",
                *(["--branch", branch] if branch else []),
                url, str(dest),
            ]
        else:
            args = [*base_args, url, str(dest)]

        code, stdout, stderr = await _run(*args)

        if code == 0:
            if subfolder:
                # Sparse checkout the specific subfolder
                sc_code, _, sc_err = await _run(
                    "git", "sparse-checkout", "set", subfolder, cwd=dest
                )
                if sc_code != 0:
                    raise GitError(f"sparse-checkout failed: {sc_err}")
                # Move subfolder contents up
                sub_path = dest / subfolder
                if sub_path.exists():
                    yield f"Extracting subfolder: {subfolder}"
                    tmp = dest.parent / f"_forge_tmp_{dest.name}"
                    shutil.copytree(sub_path, tmp)
                    shutil.rmtree(dest)
                    tmp.rename(dest)
            yield f"✓ Cloned successfully from {label}"
            return

        yield f"  ✗ {label} failed: {stderr.strip()}"
        if url == https_url:
            raise GitError(
                f"Clone failed for {repo!r}. "
                "Check the repo name, branch, and your network/SSH config."
            )


async def run_command(
    cmd: str,
    cwd: Path,
    label: str,
) -> AsyncIterator[str]:
    """
    Run an arbitrary shell command inside *cwd*, yielding output lines.
    Raises GitError (reusing for generic subprocess errors) on failure.
    """
    import shlex
    yield f"▶ {label}"

    proc = await asyncio.create_subprocess_shell(
        cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        cwd=str(cwd),
    )

    assert proc.stdout is not None
    async for raw_line in proc.stdout:
        line = raw_line.decode(errors="replace").rstrip()
        if line:
            yield f"  {line}"

    await proc.wait()
    if proc.returncode != 0:
        raise GitError(f"Command failed (exit {proc.returncode}): {cmd}")
    yield f"✓ {label}"
