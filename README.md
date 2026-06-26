# 🔨 Forge

**Forge** is an interactive terminal UI (TUI) tool for scaffolding development projects. Navigate a tree of curated templates, fill in a few variables, and let Forge generate a fully-structured project with git, Docker, CI/CD, and code conventions pre-configured.

Built with [Textual](https://github.com/Textualize/textual), runs on Windows, Linux, and macOS.

---

## Features

- 🗂 **Template tree** — browse templates organised in a hierarchical folder structure
- 📋 **Rich preview** — see what files will be generated before committing
- ⚙️ **Variable substitution** — `{{project_name}}`, `{{namespace}}`, etc. in files *and* filenames
- 🐙 **GitHub source support** — clone a public or private repo as the template base
- 🔀 **git init + initial commit** — automated, configurable
- 🐳 **Docker / CI/CD / linter** — declared in `config.jsonc`, applied at scaffold time
- 🏠 **User templates** — drop your own templates in `~/.forge/configs/`
- 📴 **Offline-first** — local templates work with zero network access

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

> **Requirements**: Python 3.11+ and `git` in your PATH.

---

## Usage

```bash
# Launch the interactive TUI
forge

# Scaffold into a specific directory
forge --output ~/projects

# Merge extra template configs
forge --configs ~/my-company-templates

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

## Template structure

Templates live in `forge/configs/` (built-in) or `~/.forge/configs/` (user-level).

```
configs/
└── my-stack/
    └── my-flavour/
        ├── config.jsonc          ← required for leaf nodes
        └── files/                ← files to copy (for local source)
            ├── {{project_name}}.sln
            └── src/
                └── {{project_name}}/
                    └── Program.cs
```

**Navigation nodes** = folders without `config.jsonc`.
**Leaf nodes** = folders that *contain* `config.jsonc`.

---

## Writing a custom template

### 1. Create the folder

```bash
mkdir -p ~/.forge/configs/my-company/fastapi-service/files
```

### 2. Write `config.jsonc`

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
    { "key": "project_name", "label": "Service name",   "default": "my-service" },
    { "key": "port",         "label": "HTTP port",      "default": "8000" }
  ],

  "git": {
    "init": true,
    "initial_branch": "main",
    "commit_message": "chore: initial scaffold via forge"
  },

  "post_init": [
    { "cmd": "python -m venv .venv",    "label": "Create virtual env" },
    { "cmd": "pip install -r requirements.txt", "label": "Install deps" }
  ]
}
```

### 3. Add your template files

Place any files under `files/`. Use `{{variable_key}}` in file content *and* in filenames/directory names:

```
files/
├── {{project_name}}/
│   ├── main.py           ← may contain {{project_name}}, {{port}}, …
│   └── requirements.txt
└── README.md
```

### 4. GitHub-hosted template

Instead of `files/`, point to a GitHub repository:

```jsonc
"source": {
  "type": "github",
  "repo": "your-org/your-template-repo",
  "branch": "main",
  "subfolder": "templates/fastapi"  // optional
}
```

Forge tries SSH first, then HTTPS. For private repos, ensure your SSH key or credential helper is configured (`~/.gitconfig`, `gh auth login`, etc.).

---

## `config.jsonc` reference

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `name` | string | ✓ | Display name shown in the TUI |
| `description` | string | | One-line description |
| `version` | string | | Semantic version |
| `tags` | string[] | | Labels shown in the preview |
| `source.type` | `"local"` \| `"github"` | ✓ | Template source |
| `source.files_dir` | string | local | Relative path to files directory |
| `source.repo` | string | github | `owner/repo` |
| `source.branch` | string | | Git branch (default: repo default) |
| `source.subfolder` | string | | Extract only a sub-directory |
| `variables` | Variable[] | | User-input variables |
| `git.init` | bool | | Run `git init` after scaffold |
| `git.initial_branch` | string | | Default: `"main"` |
| `git.commit_message` | string | | Message for the initial commit |
| `docker.enabled` | bool | | Whether Docker is used |
| `docker.compose` | bool | | Include `docker-compose.yml` |
| `cicd.enabled` | bool | | Whether CI/CD is configured |
| `cicd.provider` | string | | `"github-actions"`, `"gitlab-ci"`, … |
| `cicd.workflows` | string[] | | Workflow names to generate |
| `code_conventions.*` | object | | EditorConfig, linter, formatter, commit hooks |
| `post_init` | Step[] | | Commands run after files are placed |

**Variable object**:
```jsonc
{ "key": "my_var", "label": "Human label", "default": "value", "choices": ["a", "b"] }
```

**Post-init step**:
```jsonc
{ "cmd": "npm install", "label": "Install dependencies" }
```

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
│   ├── main.py              # CLI entry point (Typer)
│   ├── app.py               # Textual App
│   ├── screens/
│   │   ├── select_screen.py # Template tree navigation
│   │   ├── preview_screen.py# Variable form + summary
│   │   └── run_screen.py    # Live execution log
│   ├── engine/
│   │   ├── config_loader.py # JSONC config discovery
│   │   ├── scaffolder.py    # File generation orchestrator
│   │   ├── git_handler.py   # git init / clone
│   │   └── template_vars.py # {{placeholder}} interpolation
│   └── configs/             # Built-in templates
└── tests/
    ├── test_config_loader.py
    └── test_scaffolder.py
```

---

## License

MIT
