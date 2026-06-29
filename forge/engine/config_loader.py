"""forge/engine/config_loader.py — Config tree loading and resolution.

A leaf folder normally has exactly one ``config.json``/``config.jsonc`` and
collapses directly into a single leaf (back-compat, the common case).

A folder MAY instead contain several ``config*.json``/``config*.jsonc``
variant files (e.g. ``config 4 couches.json`` / ``config 7 couches.json``) —
each becomes its own leaf, and the folder itself becomes a navigation node
so the variants (and any real subdirectories) all show up as its children.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from forge.engine.asset_loader import find_manifest, load_manifest

# Built-in configs shipped with the package
_BUILTIN_CONFIGS = Path(__file__).parent.parent / "configs"


@dataclass
class TreeNode:
    """Represents one node in the config navigation tree."""

    name: str                       # display name
    path: Path                      # the leaf's directory (for files_dir/templates/etc.)
    is_leaf: bool
    children: list["TreeNode"] = field(default_factory=list)
    manifest_path: Path | None = None  # explicit manifest file, set for leaves

    @property
    def config_path(self) -> Path:
        if self.manifest_path is not None:
            return self.manifest_path
        return find_manifest(self.path, "config") or (self.path / "config.jsonc")

    def load_config(self) -> dict[str, Any]:
        """Load and return the parsed config (.json or .jsonc). Call only on leaf nodes."""
        if not self.is_leaf:
            raise ValueError(f"Node {self.name!r} is not a leaf node.")
        return load_manifest(self.config_path)


class ConfigLoader:
    """Discovers and merges configs from built-in + extra directories."""

    def __init__(self, extra_config_dirs: list[Path] | None = None):
        self._roots: list[Path] = [_BUILTIN_CONFIGS]
        if extra_config_dirs:
            self._roots.extend(extra_config_dirs)
        self._tree: TreeNode | None = None

    def get_tree(self) -> TreeNode:
        """Return the merged config tree (cached after first call)."""
        if self._tree is None:
            self._tree = self._build_merged_tree()
        return self._tree

    def invalidate(self) -> None:
        """Force a reload on next get_tree() call."""
        self._tree = None

    # ------------------------------------------------------------------ #
    # Private helpers
    # ------------------------------------------------------------------ #

    def _build_merged_tree(self) -> TreeNode:
        virtual_root = TreeNode(name="root", path=Path("/"), is_leaf=False)
        for root in self._roots:
            if not root.exists():
                continue
            try:
                entries = sorted(root.iterdir(), key=lambda p: p.name.lower())
            except PermissionError:
                continue
            for entry in entries:
                if not entry.is_dir() or entry.name.startswith(".") or entry.name == "__pycache__":
                    continue
                virtual_root.children.extend(self._scan_entry(entry))
        return virtual_root

    def _scan_entry(self, path: Path) -> list[TreeNode]:
        """Return the TreeNode(s) contributed by *path* itself."""
        try:
            entries = sorted(path.iterdir(), key=lambda p: p.name.lower())
        except PermissionError:
            return []

        config_files = [e for e in entries if e.is_file() and self._is_config_manifest(e.name)]
        subdirs = [
            e for e in entries
            if e.is_dir() and not e.name.startswith(".") and e.name != "__pycache__"
        ]

        # Common case: exactly one standard-named manifest -> this directory
        # IS the leaf, no extra navigation wrapper, subdirs treated as payload.
        if len(config_files) == 1 and config_files[0].name in ("config.json", "config.jsonc"):
            manifest = config_files[0]
            display_name = self._display_name_for(manifest, fallback=self._format_name(path.name))
            return [TreeNode(name=display_name, path=path, is_leaf=True, manifest_path=manifest)]

        # Multiple variants and/or a non-standard manifest name: this
        # directory becomes a navigation node; each config file is a leaf
        # child, and real subdirectories are scanned as usual.
        if config_files:
            multi = len(config_files) > 1
            children: list[TreeNode] = []
            for manifest in sorted(config_files, key=lambda p: p.name.lower()):
                fallback = self._format_name(manifest.stem) if multi else self._format_name(path.name)
                # When multiple variants share a directory, prefer the
                # filename for disambiguation (their "name" fields tend to
                # be identical placeholders), falling back to the JSON name otherwise.
                display_name = fallback if multi else self._display_name_for(manifest, fallback=fallback)
                children.append(TreeNode(name=display_name, path=path, is_leaf=True, manifest_path=manifest))
            for sub in subdirs:
                children.extend(self._scan_entry(sub))
            if not children:
                return []
            return [TreeNode(name=self._format_name(path.name), path=path, is_leaf=False, children=children)]

        # No manifest at all here -> pure navigation node, recurse into subdirs.
        children = []
        for sub in subdirs:
            children.extend(self._scan_entry(sub))
        if not children:
            return []
        return [TreeNode(name=self._format_name(path.name), path=path, is_leaf=False, children=children)]

    @staticmethod
    def _display_name_for(manifest: Path, fallback: str) -> str:
        try:
            cfg = load_manifest(manifest)
            return cfg.get("name", fallback)
        except Exception:
            return fallback

    @staticmethod
    def _is_config_manifest(filename: str) -> bool:
        lower = filename.lower()
        return lower.startswith("config") and (lower.endswith(".json") or lower.endswith(".jsonc"))

    @staticmethod
    def _format_name(folder_name: str) -> str:
        """Convert a folder/file-stem name to a readable display name."""
        return folder_name.replace("-", " ").replace("_", " ").title()