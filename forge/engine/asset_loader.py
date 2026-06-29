"""forge/engine/asset_loader.py — Shared recursive discovery for configs/plugins/templates.

All three asset kinds (project configs, plugins, directory templates) share the
same on-disk shape: a tree of folders, where any folder containing a manifest
file (``<name>.json`` or ``<name>.jsonc``) is a usable, independently-addressable
node, identified by its slash-separated path relative to its root — e.g.
``dotnet/efcore`` and ``dotnet/efcore/interceptor`` can both be valid plugins
even though one is nested inside the other.

Both ``.json`` and ``.jsonc`` are accepted everywhere (JSONC is just JSON with
``//`` / ``/* */`` comments allowed, parsed via ``commentjson``, which handles
plain JSON too). If both exist in the same folder, ``.jsonc`` takes priority.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import commentjson  # type: ignore


def find_manifest(directory: Path, base_name: str) -> Path | None:
    """Return the manifest file in *directory* named ``base_name.jsonc`` or
    ``base_name.json`` (jsonc takes priority), or None if neither exists."""
    jsonc_path = directory / f"{base_name}.jsonc"
    if jsonc_path.exists():
        return jsonc_path
    json_path = directory / f"{base_name}.json"
    if json_path.exists():
        return json_path
    return None


def load_manifest(path: Path) -> dict[str, Any]:
    """Parse a .json/.jsonc manifest file (comments tolerated either way)."""
    with open(path, encoding="utf-8") as f:
        return commentjson.load(f)


def copy_asset_files(src: Path, dst: Path, manifest_name: str) -> None:
    """Copy *src* into *dst*, skipping:

      - the manifest file itself (``<manifest_name>.json``/``.jsonc``)
      - any subdirectory that itself contains its own manifest — i.e. a
        nested, independently-addressable asset (e.g. ``dotnet/efcore/interceptor``
        inside ``dotnet/efcore``), which is only applied if explicitly referenced.
    """
    dst.mkdir(parents=True, exist_ok=True)
    for entry in src.iterdir():
        if entry.name in (f"{manifest_name}.json", f"{manifest_name}.jsonc"):
            continue
        if entry.is_dir():
            if find_manifest(entry, manifest_name) is not None:
                continue  # nested asset — not auto-bundled
            copy_asset_files(entry, dst / entry.name, manifest_name)
        else:
            shutil.copy2(entry, dst / entry.name)


@dataclass
class AssetNode:
    """A resolved asset: its id, on-disk folder, manifest path, and parsed config."""

    id: str
    path: Path
    manifest_path: Path
    config: dict[str, Any]

    @property
    def name(self) -> str:
        return self.config.get("name", self.id)


class RecursiveAssetLoader:
    """Discovers every folder under each root dir that contains ``<manifest_name>.json[c]``.

    Subclassed/instantiated by ConfigLoader-style trees (which need the full
    navigation tree for the TUI) is overkill here — plugins and templates are
    flat-ish lookups by id, so this just returns a dict keyed by id.
    """

    def __init__(self, manifest_name: str, builtin_root: Path, extra_dirs: list[Path] | None = None):
        self._manifest_name = manifest_name
        self._roots: list[Path] = [builtin_root]
        if extra_dirs:
            self._roots.extend(extra_dirs)
        self._assets: dict[str, AssetNode] | None = None

    def list_assets(self) -> dict[str, AssetNode]:
        if self._assets is None:
            self._assets = self._discover()
        return self._assets

    def get(self, asset_id: str) -> AssetNode:
        assets = self.list_assets()
        if asset_id not in assets:
            available = ", ".join(sorted(assets)) or "(none)"
            raise KeyError(f"Unknown {self._manifest_name} {asset_id!r}. Available: {available}")
        return assets[asset_id]

    def invalidate(self) -> None:
        self._assets = None

    # ------------------------------------------------------------------ #

    def _discover(self) -> dict[str, AssetNode]:
        result: dict[str, AssetNode] = {}
        for root in self._roots:
            if not root.exists() or not root.is_dir():
                continue
            self._walk(root, root, result)
        return result

    def _walk(self, root: Path, directory: Path, result: dict[str, AssetNode]) -> None:
        try:
            entries = sorted(directory.iterdir(), key=lambda p: p.name.lower())
        except PermissionError:
            return

        manifest = find_manifest(directory, self._manifest_name)
        if manifest is not None and directory != root:
            try:
                cfg = load_manifest(manifest)
            except Exception:
                cfg = None
            if cfg is not None:
                asset_id = directory.relative_to(root).as_posix()
                # Later roots (e.g. user-level ~/.forge/...) override earlier ones.
                result[asset_id] = AssetNode(id=asset_id, path=directory, manifest_path=manifest, config=cfg)

        for entry in entries:
            if not entry.is_dir() or entry.name.startswith(".") or entry.name == "__pycache__":
                continue
            self._walk(root, entry, result)
