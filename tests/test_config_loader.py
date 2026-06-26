"""tests/test_config_loader.py — Unit tests for ConfigLoader."""

from __future__ import annotations

import json
import textwrap
from pathlib import Path

import pytest

from forge.engine.config_loader import ConfigLoader, TreeNode


# ------------------------------------------------------------------ #
# Fixtures
# ------------------------------------------------------------------ #

@pytest.fixture()
def configs_root(tmp_path: Path) -> Path:
    """Create a minimal configs tree in a temporary directory."""
    # dotnet/aspnet/api/  ← leaf with config.jsonc
    leaf1 = tmp_path / "dotnet" / "aspnet" / "api"
    leaf1.mkdir(parents=True)
    (leaf1 / "config.jsonc").write_text(
        json.dumps({"name": "ASP.NET API", "description": "Test", "version": "1.0.0"}),
        encoding="utf-8",
    )

    # nodejs/express/  ← leaf
    leaf2 = tmp_path / "nodejs" / "express"
    leaf2.mkdir(parents=True)
    (leaf2 / "config.jsonc").write_text(
        json.dumps({"name": "Express REST", "description": "Test", "version": "1.0.0"}),
        encoding="utf-8",
    )

    # empty dir should be ignored
    (tmp_path / "empty_dir").mkdir()

    return tmp_path


# ------------------------------------------------------------------ #
# Tests
# ------------------------------------------------------------------ #

class TestConfigLoader:
    def test_get_tree_returns_root(self, configs_root: Path) -> None:
        loader = ConfigLoader(extra_config_dirs=[configs_root])
        # Override built-in to avoid real files interfering
        loader._roots = [configs_root]
        tree = loader.get_tree()
        assert tree.name == "root"

    def test_top_level_children_discovered(self, configs_root: Path) -> None:
        loader = ConfigLoader()
        loader._roots = [configs_root]
        tree = loader.get_tree()
        names = {c.name for c in tree.children}
        assert "Dotnet" in names
        assert "Nodejs" in names

    def test_empty_dir_excluded(self, configs_root: Path) -> None:
        loader = ConfigLoader()
        loader._roots = [configs_root]
        tree = loader.get_tree()
        names = {c.name for c in tree.children}
        assert "Empty Dir" not in names

    def test_leaf_node_detected(self, configs_root: Path) -> None:
        loader = ConfigLoader()
        loader._roots = [configs_root]
        tree = loader.get_tree()
        dotnet_node = next(c for c in tree.children if c.name == "Dotnet")
        aspnet_node = next(c for c in dotnet_node.children if c.name == "Aspnet")
        api_node = next(c for c in aspnet_node.children)
        assert api_node.is_leaf is True

    def test_leaf_name_from_config(self, configs_root: Path) -> None:
        loader = ConfigLoader()
        loader._roots = [configs_root]
        tree = loader.get_tree()
        dotnet = next(c for c in tree.children if c.name == "Dotnet")
        aspnet = next(c for c in dotnet.children)
        leaf = next(c for c in aspnet.children)
        assert leaf.name == "ASP.NET API"

    def test_load_config_on_leaf(self, configs_root: Path) -> None:
        loader = ConfigLoader()
        loader._roots = [configs_root]
        tree = loader.get_tree()
        dotnet = next(c for c in tree.children if c.name == "Dotnet")
        aspnet = next(c for c in dotnet.children)
        leaf = next(c for c in aspnet.children)
        cfg = leaf.load_config()
        assert cfg["name"] == "ASP.NET API"

    def test_load_config_raises_on_non_leaf(self, configs_root: Path) -> None:
        loader = ConfigLoader()
        loader._roots = [configs_root]
        tree = loader.get_tree()
        nav_node = tree.children[0]
        assert nav_node.is_leaf is False
        with pytest.raises(ValueError, match="not a leaf"):
            nav_node.load_config()

    def test_tree_cached(self, configs_root: Path) -> None:
        loader = ConfigLoader()
        loader._roots = [configs_root]
        tree1 = loader.get_tree()
        tree2 = loader.get_tree()
        assert tree1 is tree2

    def test_invalidate_clears_cache(self, configs_root: Path) -> None:
        loader = ConfigLoader()
        loader._roots = [configs_root]
        tree1 = loader.get_tree()
        loader.invalidate()
        tree2 = loader.get_tree()
        assert tree1 is not tree2

    def test_merge_multiple_roots(self, tmp_path: Path) -> None:
        root_a = tmp_path / "a"
        root_b = tmp_path / "b"
        leaf_a = root_a / "framework_a"
        leaf_b = root_b / "framework_b"
        leaf_a.mkdir(parents=True)
        leaf_b.mkdir(parents=True)
        (leaf_a / "config.jsonc").write_text(json.dumps({"name": "Framework A"}), encoding="utf-8")
        (leaf_b / "config.jsonc").write_text(json.dumps({"name": "Framework B"}), encoding="utf-8")

        loader = ConfigLoader()
        loader._roots = [root_a, root_b]
        tree = loader.get_tree()
        names = {c.name for c in tree.children}
        assert "Framework A" in names
        assert "Framework B" in names

    def test_nonexistent_root_ignored(self, tmp_path: Path) -> None:
        loader = ConfigLoader()
        loader._roots = [tmp_path / "does_not_exist"]
        tree = loader.get_tree()
        assert tree.children == []

    def test_format_name_converts_dashes(self) -> None:
        assert ConfigLoader._format_name("clean-archi") == "Clean Archi"
        assert ConfigLoader._format_name("ef_core") == "Ef Core"
        assert ConfigLoader._format_name("ntier") == "Ntier"

    def test_jsonc_with_comments(self, tmp_path: Path) -> None:
        """ConfigLoader must parse JSONC files that contain // comments."""
        leaf = tmp_path / "mytemplate"
        leaf.mkdir()
        (leaf / "config.jsonc").write_text(
            textwrap.dedent("""\
                {
                  // This is a comment
                  "name": "Commented Config",
                  // version comment
                  "version": "1.0.0"
                }
            """),
            encoding="utf-8",
        )
        loader = ConfigLoader()
        loader._roots = [tmp_path]
        tree = loader.get_tree()
        leaf_node = tree.children[0]
        assert leaf_node.name == "Commented Config"
