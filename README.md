# 🔨 Forge

**Forge** is an interactive terminal UI (TUI) tool for scaffolding development projects. Browse a tree of curated configs, fill in a few variables, pick which plugins to bolt on, and let Forge generate a fully-structured project — with git, Docker, CI/CD, and a build/test/format pipeline ready to go.

Built with [Textual](https://github.com/Textualize/textual), runs on Windows, Linux, and macOS.

---

## Features

- 🗂 **Config tree** — browse project configs organised in a hierarchical folder structure
- 📋 **Rich preview** — see what will be generated, and pick which plugins to apply, before committing
- ⚙️ **Variable substitution** — real Jinja2 (`{{project_name}}`, `{% for %}`, …) in files *and* filenames
- 🧪 **JSON or JSONC** — every manifest (`config`, `plugin`, `template`) accepts plain `.json` or commented `.jsonc`
- 🚀 **Skip static templates** — generate via the project's own CLI (`npm create vite@latest`), a script, or both — not just copied files
- 🧩 **Plugins** — reusable extensions (auth, ORM setup, logging interceptors, …) any config can opt into, selectable per-run
- 🏗 **Directory templates** — reusable folder skeletons (e.g. the conventional React `hooks/`, `components/ui/`, `lib/`, `types/`, `contexts/` layout)
- 🐳 **Dockerfile / docker-compose / CI-CD / pipeline** — offered for *every* project, dispatched per tech stack, never tied to a specific config
- 🔀 **git init + one consistent first commit** — automatic, every project, every time
- 🖥 **Non-blocking installs** — commands that need a real terminal (wizards, prompts) get one, via terminal hand-off — the TUI never blocks input
- 🏠 **User-level overrides** — drop your own configs/plugins/templates in `~/.forge/{configs,plugins,templates}/`
- 📴 **Offline-first** — local/file-based configs work with zero network access

---

## Installation

### via pipx (recommended)

```bash
pipx install forge-cli
```

### via pip

```bash
pip install forge-cli
```

### from source

```bash
git clone https://github.com/yourname/forge.git
cd forge
pipx install .
```

> **Requirements**: Python 3.11+ and `git` in your PATH. On Windows, Git for Windows (which ships Git Bash) covers both.

---

## Usage

```bash
# Launch the interactive TUI
forge

# Scaffold into a specific directory
forge --output ~/projects

# Merge extra configs / plugins / directory-templates
forge --configs ~/my-company-configs --plugins ~/my-plugins --templates ~/my-templates

# Headless / CI mode — no TUI, no piping (the terminal is already free)
forge --no-tui --config-id react/vite-cli --var project_name=my-app

# Show version
forge --version
```

### Keyboard shortcuts (inside the TUI)

| Key | Action |
|-----|--------|
| `↑` / `k` | Move cursor up |
| `↓` / `j` | Move cursor down |
| `Enter` | Select / drill down |
| `Backspace` / `Esc` | Go back one level |
| `q` | Quit |

---

## Config tree

Configs live in `forge/configs/` (built-in) or `~/.forge/configs/` (user-level). Plugins and directory-templates live as **siblings** of `configs/`:

```
forge/
├── configs/                  ← the TUI's navigation tree
│   └── my-stack/
│       └── my-flavour/
│           ├── config.json   ← or config.jsonc — required for leaf nodes
│           └── files/        ← files to copy (only for a "local" source step)
├── plugins/                  ← reusable extensions, opt-in per config
│   └── dotnet/
│       ├── jwt/
│       │   ├── plugin.json
│       │   └── AuthExtensions.cs
│       └── efcore/
│           ├── plugin.json
│           ├── DatabaseExtensions.cs
│           └── interceptor/          ← nested, independently-addressable plugin
│               ├── plugin.json
│               └── EfSlowQueryInterceptor.cs
└── templates/                 ← reusable directory skeletons, opt-in per config
    └── react/
        └── structure/
            ├── template.json
            ├── hooks/useExample.ts
            ├── components/ui/Button.tsx
            ├── lib/utils.ts
            ├── types/index.ts
            └── contexts/AppContext.tsx
```

**Navigation nodes** = folders without a `config.json[c]`.
**Leaf nodes** = folders that *contain* one. Same rule, recursively, for plugins (`plugin.json[c]`) and templates (`template.json[c]`) — a plugin/template id is just its slash-separated path, e.g. `dotnet/efcore/interceptor`.

### Execution order

1. **config** — the config's own `source` steps
2. **templates** — directory skeletons listed in `config["templates"]`
3. **plugins** — extensions listed in `config["plugins"]` (only the ones the user kept checked in the Preview screen)
4. **extras** — Dockerfile / docker-compose / CI-CD / pipeline (see below)
5. `git init`
6. `post_init` commands (interactive)
7. pipeline commands — build/test/format (interactive)
8. `git add` + the initial commit — **always**, same message, every project

---

## Writing a custom config

### 1. Create the folder

```bash
mkdir -p ~/.forge/configs/my-company/fastapi-service/files
```

### 2. Write `config.json` (or `config.jsonc` if you want comments)

```jsonc
{
  "name": "FastAPI Microservice",
  "description": "Async Python REST API with FastAPI + SQLAlchemy.",
  "version": "1.0.0",
  "tags": ["python", "fastapi", "async"],

  "source": {
    "type": "local",
    "files_dir": "./files"
  },

  "variables": [
    { "key": "project_name", "label": "Service name", "default": "my-service" },
    { "key": "port",         "label": "HTTP port",     "default": "8000" }
  ],

  "post_init": [
    { "cmd": "python -m venv .venv",             "label": "Create virtual env" },
    { "cmd": "pip install -r requirements.txt",  "label": "Install deps" }
  ]
}
```

`git init` + the first commit happen automatically after this — you don't declare them.

### 3. Add your template files

Place any files under `files/`. Use `{{variable_key}}` in file content *and* in filenames/directory names (real Jinja2 under the hood — `{% for %}` / `{% if %}` work too):

```
files/
├── {{project_name}}/
│   ├── main.py           ← may contain {{project_name}}, {{port}}, …
│   └── requirements.txt
└── README.md
```

### 4. Skip the static template — generate via CLI or script instead

A `source` step doesn't have to copy files at all:

```jsonc
// run the project's own official generator directly
"source": {
  "type": "command",
  "commands": [
    { "cmd": "npm create vite@latest {{project_name}} -- --template react-ts", "label": "Run Vite CLI" }
  ]
}
```

```jsonc
// or hand off to a script (bash / Git Bash / .cmd / .ps1 — auto-detected by extension)
"source": {
  "type": "script",
  "script": "./scaffold.sh",
  "script_windows": "./scaffold.ps1",
  "args": ["{{project_name}}"]
}
```

By default a `command`/`script` step is assumed to create the project directory itself (most CLIs do, e.g. `npm create vite@latest my-app` makes `./my-app`) — set `"creates_dir": false` if Forge should create the folder for you instead.

`source` can also be a **list** of steps, run in order — mix and match a CLI/script with a `local` overlay on top:

```jsonc
"source": [
  { "type": "script", "script": "./scaffold.sh", "args": ["{{project_name}}"] },
  { "type": "local",  "files_dir": "./files" }
]
```

### 5. GitHub-hosted template

```jsonc
"source": {
  "type": "github",
  "repo": "your-org/your-template-repo",
  "branch": "main",
  "subfolder": "templates/fastapi"  // optional
}
```

Forge tries SSH first, then HTTPS. For private repos, configure your SSH key or credential helper (`~/.gitconfig`, `gh auth login`, etc.).

---

## Templates (directory skeletons)

A **template** is a reusable folder layout — not tied to any one config — e.g. the conventional React structure (`hooks/`, `components/ui/`, `lib/`, `types/`, `contexts/`). Any config opts in:

```jsonc
"templates": ["react/structure"]
```

Write one like a config, but with `template.json[c]` instead of `config.json[c]`, and the files sitting directly alongside it (no `files/` subfolder needed — that's the default `files_dir: "."`):

```jsonc
{
  "name": "React — Project Structure",
  "target_dir": "src",     // where this lands under the project root
  "apply": { "type": "local" }
}
```

---

## Plugins (extensions)

A **plugin** is a small, reusable, non-template-specific piece of code — a JWT auth extension, an EF Core interceptor, a Prisma setup — that any config can offer. List the ids it's compatible with:

```jsonc
"plugins": [
  "dotnet/jwt",
  { "id": "dotnet/efcore/interceptor", "variables": { "seuil_ms": "500" } }
]
```

This is a **menu, not a mandate** — every listed plugin shows up as a checkbox (pre-checked) in the Preview screen, and only the ones still checked when you confirm get applied.

A plugin folder looks like:

```
forge/plugins/dotnet/efcore/
├── plugin.json
├── DatabaseExtensions.cs        ← payload, applied with "local" by default
└── interceptor/                 ← a separate, nested plugin — NOT auto-bundled
    ├── plugin.json
    └── EfSlowQueryInterceptor.cs
```

```jsonc
// plugin.json
{
  "name": "EF Core — Database Registration",
  "variables": [
    { "key": "database_count", "default": "1" }   // {% for %} loop inside the .cs file
  ],
  "target_dir": ".",              // where files land under the project root
  "apply": { "type": "local" },   // or "command" / "script" — same shapes as config sources
  "post_apply": [
    { "cmd": "dotnet add package Microsoft.EntityFrameworkCore.Sqlite", "label": "Add SQLite" }
  ]
}
```

Variable resolution for a plugin is: **plugin's own defaults < the project's variables < per-reference overrides** — so a plugin works standalone (sensible defaults), picks up matching project variables automatically (e.g. both declare `root_namespace`), and can still be tuned per-reference.

Because file rendering is real Jinja2, a plugin can scale with a variable instead of being fixed to one shape — e.g. the built-in `dotnet/efcore` plugin generates N `DbContext` registrations from a single `database_count` variable:

```csharp
{% for i in range(1, (database_count|int) + 1) %}
services.AddDbContext<App{{ i }}DbContext>(...);
{% endfor %}
```

---

## Dockerfile / docker-compose / CI-CD / pipeline ("always present")

These are **never** declared per-config — they're offered for every project, the same way, regardless of stack. The Preview screen always shows:

- Dockerfile (on/off)
- docker-compose (on/off)
- CI/CD (on/off) + provider (GitHub Actions / GitLab CI / Azure DevOps)
- Pipeline steps: build / test / format (toggle individually)

What each one actually *contains* is dispatched per tech stack via a **constructor** (`forge/engine/constructors/{nodejs,dotnet}.py` — add your own and register it for a new stack). A config can narrow or extend the *default* pipeline selection with a top-level `"pipeline"` field (e.g. `"pipeline": ["build", "test"]` to drop `format` by default) — that's a default, not a cap; the toggle is always there.

```python
# forge/engine/constructors/your_stack.py
class YourStackConstructor(StackConstructor):
    stack_id = "your-stack"
    def dockerfile(self, variables): ...
    def docker_compose(self, variables): ...
    def ci_workflow(self, provider, pipeline, variables): ...   # -> {path: content}
    def pipeline_commands(self, pipeline, variables): ...        # -> [{"cmd":..., "label":...}]
```

```python
# register it (e.g. in your own startup code, or forge/engine/constructors/__init__.py)
from forge.engine.constructors import register_constructor
register_constructor("your-stack", YourStackConstructor())
```

A config opts a constructor in via an explicit `"stack"` field, or Forge infers it from the first matching tag in `"tags"`.

---

## Interactive installs — the TUI never blocks

Any step that shells out to something that might prompt (the project's own CLI wizard, a setup script, `post_init`, the build/test/format pipeline) hands the **real terminal** over to that process — via Textual's `app.suspend()` — instead of capturing its output. You can type into prompts normally; once the command exits, the TUI resumes and keeps logging. `--no-tui` mode doesn't need this trick at all, since the terminal is already free.

---

## `config.json` / `config.jsonc` reference

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `name` | string | ✓ | Display name shown in the TUI |
| `description` | string | | One-line description |
| `version` | string | | Semantic version |
| `tags` | string[] | | Labels shown in the preview; also used to infer the stack constructor |
| `stack` | string | | Explicit constructor id (`"nodejs"`, `"dotnet"`, …) — overrides tag inference |
| `source` | Step \| Step[] | | One step, or a list run in order. Omit entirely for a config that relies only on `templates`/`plugins` |
| `source.type` | `"local"` \| `"github"` \| `"command"` \| `"script"` | | Defaults to `"local"` |
| `source.files_dir` | string | local | Default `"./files"` |
| `source.repo` / `.branch` / `.subfolder` | string | github | |
| `source.commands` | `{cmd, label}[]` | command | `{{var}}`-interpolated |
| `source.script` / `.script_windows` / `.args` | string / string / string[] | script | |
| `source.creates_dir` | bool | command/script | Default `true` — the step creates the project dir itself |
| `templates` | (string \| `{id, target_dir?, variables?}`)[] | | Directory skeletons to apply |
| `plugins` | (string \| `{id, target_dir?, variables?}`)[] | | Compatible plugins, offered (not forced) in the Preview screen |
| `pipeline` | string[] | | Default selection for the always-on build/test/format toggle |
| `variables` | Variable[] | | User-input variables |
| `git.initial_branch` | string | | Default `"main"` — `git init` + the first commit always happen |
| `post_init` | Step[] | | Commands run after everything else, before the final commit (interactive) |

**Variable object**: `{ "key": "my_var", "label": "Human label", "default": "value", "choices": ["a", "b"] }`

**Plugin/template manifest** (`plugin.json[c]` / `template.json[c]`): same `variables`, plus `target_dir` (default `"."`) and `apply` (same shape as a single `source` step: `"local"` / `"command"` / `"script"`), plus `post_apply` (same shape as `post_init`).

---

## Development

```bash
git clone https://github.com/yourname/forge.git
cd forge
pip install -e ".[dev]"

# Run tests
pytest

# Run with Textual devtools (live reload)
textual run --dev forge.main:app
```

---

## Project layout

```
forge/
├── pyproject.toml
├── forge/
│   ├── main.py                  # CLI entry point (Typer) — TUI and --no-tui
│   ├── app.py                   # Textual App
│   ├── screens/
│   │   ├── select_screen.py     # Config tree navigation
│   │   ├── preview_screen.py    # Variables, plugin selection, always-present extras
│   │   └── run_screen.py        # Live log + interactive terminal hand-off
│   ├── engine/
│   │   ├── asset_loader.py      # Shared recursive discovery (configs/plugins/templates)
│   │   ├── config_loader.py     # Config tree (TUI navigation)
│   │   ├── plugin_loader.py     # Plugin discovery
│   │   ├── templates_loader.py  # Directory-template discovery
│   │   ├── scaffolder.py        # Orchestrates config → templates → plugins → extras → git
│   │   ├── constructors/        # Per-stack Dockerfile/compose/CI/pipeline (nodejs.py, dotnet.py, …)
│   │   ├── git_handler.py       # git init / clone / interactive + captured command execution
│   │   ├── script_runner.py     # Cross-platform script resolution (bash/Git Bash/.cmd/.ps1)
│   │   └── template_vars.py     # Jinja2-based {{placeholder}} / {% for %} interpolation
│   ├── configs/                 # Built-in configs (TUI tree)
│   ├── plugins/                 # Built-in plugins
│   └── templates/                # Built-in directory templates
└── tests/
```

---

## License

MIT
