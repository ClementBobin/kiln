"""tests/test_asset_loader.py — Tests for the shared plugin/template discovery layer."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from forge.engine.asset_loader import (
    RecursiveAssetLoader,
    copy_asset_files,
    find_manifest,
    load_manifest,
)


class TestFindManifest:
    def test_prefers_jsonc_over_json(self, tmp_path: Path) -> None:
        (tmp_path / "plugin.json").write_text("{}")
        (tmp_path / "plugin.jsonc").write_text("{}")
        manifest = find_manifest(tmp_path, "plugin")
        assert manifest is not None
        assert manifest.name == "plugin.jsonc"

    def test_falls_back_to_plain_json(self, tmp_path: Path) -> None:
        (tmp_path / "plugin.json").write_text("{}")
        manifest = find_manifest(tmp_path, "plugin")
        assert manifest is not None
        assert manifest.name == "plugin.json"

    def test_none_when_missing(self, tmp_path: Path) -> None:
        assert find_manifest(tmp_path, "plugin") is None


class TestLoadManifest:
    def test_loads_plain_json(self, tmp_path: Path) -> None:
        p = tmp_path / "x.json"
        p.write_text(json.dumps({"name": "X"}))
        assert load_manifest(p) == {"name": "X"}

    def test_loads_jsonc_with_comments(self, tmp_path: Path) -> None:
        p = tmp_path / "x.jsonc"
        p.write_text('{\n  // a comment\n  "name": "X"\n}')
        assert load_manifest(p) == {"name": "X"}


class TestRecursiveAssetLoader:
    def test_discovers_nested_ids(self, tmp_path: Path) -> None:
        (tmp_path / "dotnet" / "efcore" / "interceptor").mkdir(parents=True)
        (tmp_path / "dotnet" / "efcore" / "plugin.json").write_text(json.dumps({"name": "EfCore"}))
        (tmp_path / "dotnet" / "efcore" / "interceptor" / "plugin.json").write_text(
            json.dumps({"name": "Interceptor"})
        )

        loader = RecursiveAssetLoader("plugin", tmp_path)
        assets = loader.list_assets()

        assert set(assets) == {"dotnet/efcore", "dotnet/efcore/interceptor"}
        assert assets["dotnet/efcore"].name == "EfCore"
        assert assets["dotnet/efcore/interceptor"].name == "Interceptor"

    def test_does_not_register_root_itself(self, tmp_path: Path) -> None:
        (tmp_path / "plugin.json").write_text(json.dumps({"name": "RootShouldNotCount"}))
        loader = RecursiveAssetLoader("plugin", tmp_path)
        assert loader.list_assets() == {}

    def test_get_raises_with_available_list(self, tmp_path: Path) -> None:
        (tmp_path / "foo").mkdir()
        (tmp_path / "foo" / "plugin.json").write_text(json.dumps({"name": "Foo"}))
        loader = RecursiveAssetLoader("plugin", tmp_path)
        with pytest.raises(KeyError, match="foo"):
            loader.get("bar")

    def test_extra_dirs_override_builtin(self, tmp_path: Path) -> None:
        builtin = tmp_path / "builtin"
        extra = tmp_path / "extra"
        (builtin / "x").mkdir(parents=True)
        (extra / "x").mkdir(parents=True)
        (builtin / "x" / "plugin.json").write_text(json.dumps({"name": "Builtin"}))
        (extra / "x" / "plugin.json").write_text(json.dumps({"name": "UserOverride"}))

        loader = RecursiveAssetLoader("plugin", builtin, [extra])
        assert loader.get("x").name == "UserOverride"

    def test_skips_unparseable_manifest(self, tmp_path: Path) -> None:
        (tmp_path / "broken").mkdir()
        (tmp_path / "broken" / "plugin.json").write_text("")  # empty -> invalid JSON
        loader = RecursiveAssetLoader("plugin", tmp_path)
        assert loader.list_assets() == {}

    def test_invalidate_forces_rescan(self, tmp_path: Path) -> None:
        loader = RecursiveAssetLoader("plugin", tmp_path)
        assert loader.list_assets() == {}
        (tmp_path / "new").mkdir()
        (tmp_path / "new" / "plugin.json").write_text(json.dumps({"name": "New"}))
        assert loader.list_assets() == {}  # cached
        loader.invalidate()
        assert "new" in loader.list_assets()


class TestCopyAssetFiles:
    def test_excludes_manifest_and_nested_assets(self, tmp_path: Path) -> None:
        src = tmp_path / "src"
        (src / "interceptor").mkdir(parents=True)
        (src / "plugin.json").write_text(json.dumps({"name": "Parent"}))
        (src / "interceptor" / "plugin.json").write_text(json.dumps({"name": "Child"}))
        (src / "interceptor" / "Inner.cs").write_text("inner")
        (src / "Payload.cs").write_text("payload")

        dst = tmp_path / "dst"
        copy_asset_files(src, dst, "plugin")

        copied = sorted(p.relative_to(dst) for p in dst.rglob("*") if p.is_file())
        assert copied == [Path("Payload.cs")]

    def test_copies_plain_subdirectories(self, tmp_path: Path) -> None:
        src = tmp_path / "src"
        (src / "sub").mkdir(parents=True)
        (src / "sub" / "File.cs").write_text("x")

        dst = tmp_path / "dst"
        copy_asset_files(src, dst, "plugin")

        assert (dst / "sub" / "File.cs").exists()
