"""forge/engine/plugin_loader.py — Discover and resolve reusable plugins/extensions.

A *plugin* is a small, reusable, non-template-specific piece of code (an EF Core
interceptor, a JWT auth extension, an enum helper, …) that any project config
opts into by listing its id under a top-level ``"plugins"`` array:

```jsonc
"plugins": [
  "dotnet/jwt",
  { "id": "dotnet/efcore/interceptor", "variables": { "seuil_ms": "500" } }
]
```

Plugins live in ``forge/plugins/<id>/`` (built-in) and/or ``~/.forge/plugins/<id>/``
(user-level, merged on top). Ids are slash-separated relative paths, so plugins
can nest (e.g. ``dotnet/efcore`` and ``dotnet/efcore/interceptor`` are both
independently addressable). Each plugin folder contains a ``plugin.json`` or
``plugin.jsonc`` describing how it's applied — see ``forge/plugins/**/plugin.json``
for real examples covering all three application styles:

  - ``"type": "local"``   — copy the plugin's own files (interpolated, like templates)
  - ``"type": "command"`` — run one or more CLI commands (e.g. `dotnet add package`)
  - ``"type": "script"``  — run a bash/Git-Bash/.cmd/.ps1 script
"""

from __future__ import annotations

from pathlib import Path

from forge.engine.asset_loader import AssetNode, RecursiveAssetLoader

# Re-exported so callers can do `from forge.engine.plugin_loader import PluginInfo`
PluginInfo = AssetNode

_BUILTIN_PLUGINS = Path(__file__).parent.parent / "plugins"


class PluginLoader(RecursiveAssetLoader):
    def __init__(self, extra_plugin_dirs: list[Path] | None = None):
        super().__init__("plugin", _BUILTIN_PLUGINS, extra_plugin_dirs)
