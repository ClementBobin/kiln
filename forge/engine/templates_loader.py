"""forge/engine/templates_loader.py — Discover and resolve reusable directory templates.

A *template* (not to be confused with a project ``config.json`` "template" in
the TUI tree) is a reusable directory skeleton — e.g. the conventional React
folder layout (``hooks/``, ``components/ui/``, ``lib/``, ``types/``,
``contexts/``) — that any project config opts into via a top-level
``"templates"`` array:

```jsonc
"templates": ["react/structure"]
```

Templates live in ``forge/templates/<id>/`` (built-in, sibling of
``forge/plugins/``) and/or ``~/.forge/templates/<id>/`` (user-level, merged on
top). Like plugins, ids are slash-separated and can nest. Each template folder
contains a ``template.json`` or ``template.jsonc`` and is applied with the same
"local" / "command" / "script" mechanics as plugins and config sources.
"""

from __future__ import annotations

from pathlib import Path

from forge.engine.asset_loader import AssetNode, RecursiveAssetLoader

TemplateInfo = AssetNode

_BUILTIN_TEMPLATES = Path(__file__).parent.parent / "templates"


class TemplateLoader(RecursiveAssetLoader):
    def __init__(self, extra_template_dirs: list[Path] | None = None):
        super().__init__("template", _BUILTIN_TEMPLATES, extra_template_dirs)
