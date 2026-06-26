"""forge/engine/config_loader.py — Config tree loading and resolution."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import commentjson  # type: ignore


# Built-in configs shipped with the package
_BUILTIN_CONFIGS = Path(__file__).parent.parent / "configs"


@dataclass
class TreeNode:
    """Represents one node in the template navigation tree."""

    name: str          # display name (folder name, title-cased)
    path: Path         # filesystem path
    is_leaf: bool      # True if this folder contains a config.jsonc
    children: list["TreeNode"] = field(default_factory=list)

    @property
    def config_path(self) -> Path:
        return self.path / "config.jsonc"

    def load_config(self) -> dict[str, Any]:
        """Load and return the parsed JSONC config. Call only on leaf nodes."""
        if not self.is_leaf:
            raise ValueError(f"Node {self.name!r} is not a leaf node.")
        with open(self.config_path, encoding="utf-8") as f:
            return commentjson.load(f)


class ConfigLoader:
    """Discovers and merges template configs from built-in + extra directories."""

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
        """Build a virtual root by merging children from all root directories."""
        virtual_root = TreeNode(name="root", path=Path("/"), is_leaf=False)
        for root in self._roots:
            if not root.exists():
                continue
            children = self._scan_dir(root)
            virtual_root.children.extend(children)
        return virtual_root

    def _scan_dir(self, path: Path) -> list[TreeNode]:
        """Recursively scan a directory and return its children as TreeNodes."""
        if not path.is_dir():
            return []

        nodes: list[TreeNode] = []
        try:
            entries = sorted(path.iterdir(), key=lambda p: p.name.lower())
        except PermissionError:
            return []

        for entry in entries:
            if not entry.is_dir():
                continue
            if entry.name.startswith(".") or entry.name == "__pycache__":
                continue

            config_file = entry / "config.jsonc"
            if config_file.exists():
                # Leaf node
                display_name = self._format_name(entry.name)
                try:
                    with open(config_file, encoding="utf-8") as f:
                        cfg = commentjson.load(f)
                    display_name = cfg.get("name", display_name)
                except Exception:
                    pass
                nodes.append(TreeNode(name=display_name, path=entry, is_leaf=True))
            else:
                # Navigation node — recurse
                children = self._scan_dir(entry)
                if children:  # only include non-empty dirs
                    nodes.append(
                        TreeNode(
                            name=self._format_name(entry.name),
                            path=entry,
                            is_leaf=False,
                            children=children,
                        )
                    )

        return nodes

    @staticmethod
    def _format_name(folder_name: str) -> str:
        """Convert folder name to a readable display name."""
        return folder_name.replace("-", " ").replace("_", " ").title()
