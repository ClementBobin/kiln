# kiln — npm CLI

> 🔥 Interactive project scaffolding — the same kiln config system, deployed via npm.

```sh
npx kiln@latest
```

---

## Usage

### Interactive mode (default)

```sh
npx kiln@latest
# or after global install:
kiln
```

Walks you through an interactive picker to choose a template, fill in variables, and scaffold your project.

### Headless / CI mode

```sh
kiln run --config-id react/vite --var project_name=my-app --var description="My app" -o ./my-app
```

| Flag | Description |
|------|-------------|
| `--config-id <id>` | Slash-separated config path (required) |
| `--var key=value` | Template variable (repeatable) |
| `-o, --output <dir>` | Output directory (default: cwd) |
| `-c, --configs <dir>` | Extra configs directory |

### List configs

```sh
kiln list
```

### Validate a config

```sh
kiln validate ./my-config/config.json
```

Prints typed diagnostics:

```
  ✖ [error]   config/name must be string (at /name)
  ⚠ [warning] source.type is "command" but no commands are defined (at /source/commands)
  ⚠ [warning] Duplicate variable key "foo" (at /variables)
```

- **error** — config cannot be used (required fields missing, wrong type, invalid enum)
- **warning** — config will work but something looks suspicious

---

## Config format (`config.json` / `config.jsonc`)

Same format as the Python TUI — configs live under `configs/<category>/<name>/config.json`.

```jsonc
{
  "name": "React — Vite + TypeScript",
  "description": "React SPA with Vite and TypeScript",
  "version": "1.0.0",
  "tags": ["react", "vite", "typescript"],

  "source": {
    "type": "command",   // "command" | "local" | "github" | "script"
    "commands": [
      { "cmd": "npm create vite@latest {{project_name}}", "label": "Run Vite CLI" }
    ]
  },

  "variables": [
    { "key": "project_name", "label": "Project name", "default": "my-app" },
    { "key": "description",  "label": "Description",  "default": "A React app" }
  ],

  "post_init": [
    { "cmd": "npm install", "label": "Install dependencies" }
  ]
}
```

JSONC (JSON with `//` and `/* */` comments) is supported everywhere.

### Custom configs

Point kiln at your own config directory:

```sh
kiln --configs ./my-configs
kiln run --configs ./my-configs --config-id myteam/mystack
```

Or drop your configs in `~/.kiln/configs/` and they'll be picked up automatically.

---

## Requirements

- Node.js ≥ 18
- git (must be in PATH)
