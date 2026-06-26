"""forge/screens/preview_screen.py — Template preview and variable input screen."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, ScrollableContainer, Vertical
from textual.screen import Screen
from textual.widgets import (
    Button,
    Footer,
    Header,
    Input,
    Label,
    Select,
    Static,
)

from forge.engine.config_loader import TreeNode
from forge.engine.scaffolder import preview_tree


class SectionTitle(Static):
    DEFAULT_CSS = """
    SectionTitle {
        color: $accent;
        text-style: bold;
        padding: 1 0 0 0;
    }
    """


class PreviewScreen(Screen):
    """Shows template details and collects variable values before scaffolding."""

    BINDINGS = [
        Binding("escape", "go_back", "Back"),
        Binding("q", "quit_app", "Quit"),
    ]

    def __init__(self, node: TreeNode, output_dir: Path):
        super().__init__()
        self.node = node
        self.output_dir = output_dir
        self._config: dict[str, Any] = {}
        self._var_widgets: dict[str, Input | Select] = {}
        self._github_ok: bool | None = None  # None = not checked yet

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #

    def compose(self) -> ComposeResult:
        yield Header()
        yield ScrollableContainer(
            Static(id="template-name", classes="panel-title"),
            Static(id="template-desc"),
            SectionTitle("🏷  Tags"),
            Static(id="tags-line"),
            SectionTitle("📂  Files that will be generated"),
            Static(id="file-tree"),
            SectionTitle("⚙️  Variables"),
            Vertical(id="vars-container"),
            SectionTitle("📋  Actions summary"),
            Static(id="summary"),
            Horizontal(
                Button("✓  Confirm", id="btn-confirm", variant="success"),
                Button("← Back", id="btn-back"),
                Button("✗  Cancel", id="btn-cancel", variant="error"),
                id="buttons",
            ),
        )
        yield Footer()

    def on_mount(self) -> None:
        try:
            self._config = self.node.load_config()
        except Exception as e:
            self.query_one("#template-name", Static).update(f"[red]Error loading config: {e}[/red]")
            return

        self._populate()
        self._check_github_async()

    # ------------------------------------------------------------------ #
    # Populate widgets from config
    # ------------------------------------------------------------------ #

    def _populate(self) -> None:
        cfg = self._config

        self.query_one("#template-name", Static).update(
            f"[bold]{cfg.get('name', self.node.name)}[/bold]  "
            f"[dim]v{cfg.get('version', '?')}[/dim]"
        )
        self.query_one("#template-desc", Static).update(
            cfg.get("description", "No description provided.")
        )

        tags = cfg.get("tags", [])
        tag_str = "  ".join(f"[on blue] {t} [/on blue]" for t in tags) if tags else "[dim]none[/dim]"
        self.query_one("#tags-line", Static).update(tag_str)

        # File tree
        tree_lines = preview_tree(cfg, self.node.config_path)
        tree_text = "\n".join(tree_lines) if tree_lines else "(empty)"
        self.query_one("#file-tree", Static).update(tree_text)

        # Variables form
        vars_container = self.query_one("#vars-container", Vertical)
        for var in cfg.get("variables", []):
            key = var.get("key", "")
            label = var.get("label", key)
            default = var.get("default", "")
            choices = var.get("choices")

            vars_container.mount(Label(f"{label}:"))
            if choices:
                opts = [(c, c) for c in choices]
                widget: Input | Select = Select(
                    options=opts,
                    value=default if default in choices else choices[0],
                    id=f"var_{key}",
                )
            else:
                widget = Input(
                    value=str(default),
                    placeholder=label,
                    id=f"var_{key}",
                )
            vars_container.mount(widget)
            self._var_widgets[key] = widget

        # Summary
        self.query_one("#summary", Static).update(self._build_summary())

    def _build_summary(self) -> str:
        cfg = self._config
        lines: list[str] = []

        git_cfg = cfg.get("git", {})
        if git_cfg.get("init"):
            branch = git_cfg.get("initial_branch", "main")
            lines.append(f"  ✓ git init  (branch: {branch})")

        docker = cfg.get("docker", {})
        if docker.get("enabled"):
            compose_flag = " + docker-compose" if docker.get("compose") else ""
            lines.append(f"  ✓ Docker{compose_flag}")

        cicd = cfg.get("cicd", {})
        if cicd.get("enabled"):
            provider = cicd.get("provider", "?")
            lines.append(f"  ✓ CI/CD — {provider}")

        cc = cfg.get("code_conventions", {})
        if cc.get("editorconfig"):
            lines.append("  ✓ .editorconfig")
        linter = cc.get("linter", {})
        if linter.get("enabled"):
            lines.append(f"  ✓ Linter: {linter.get('type', '?')}")
        formatter = cc.get("formatter", {})
        if formatter.get("enabled"):
            lines.append(f"  ✓ Formatter: {formatter.get('type', '?')}")

        post_init = cfg.get("post_init", [])
        if post_init:
            lines.append(f"  ✓ {len(post_init)} post-init command(s)")

        source = cfg.get("source", {})
        steps = source if isinstance(source, list) else [source]
        for step in steps:
            stype = step.get("type", "local")
            if stype == "github":
                repo = step.get("repo", "?")
                lines.append(f"  ⇣ Clone GitHub: {repo}")
                if self._github_ok is True:
                    lines.append("    [green]✓ Repo reachable[/green]")
                elif self._github_ok is False:
                    lines.append("    [red]✗ Repo not reachable[/red]")
                else:
                    lines.append("    [dim]⠋ Checking repo…[/dim]")
            elif stype == "command":
                n = len(step.get("commands", []))
                lines.append(f"  ▶ Run {n} command(s) directly (no template files)")
            elif stype == "script":
                lines.append(f"  ▶ Run script: {step.get('script', '?')}")

        return "\n".join(lines) if lines else "[dim]No extra actions configured.[/dim]"

    def _check_github_async(self) -> None:
        """Fire and forget GitHub availability check."""
        source = self._config.get("source", {})
        steps = source if isinstance(source, list) else [source]
        for step in steps:
            if step.get("type") != "github":
                continue
            repo = step.get("repo", "")
            if not repo:
                continue
            import asyncio
            asyncio.get_event_loop().create_task(self._check_github(repo))
            return

    async def _check_github(self, repo: str) -> None:
        try:
            import httpx
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.head(f"https://github.com/{repo}")
                self._github_ok = r.status_code < 400
        except Exception:
            self._github_ok = False
        # Refresh summary
        self.query_one("#summary", Static).update(self._build_summary())

    # ------------------------------------------------------------------ #
    # Collect values and launch
    # ------------------------------------------------------------------ #

    def _collect_variables(self) -> dict[str, str]:
        result: dict[str, str] = {}
        for key, widget in self._var_widgets.items():
            if isinstance(widget, Select):
                val = widget.value
                result[key] = str(val) if val is not None else ""
            else:
                result[key] = widget.value
        return result

    # ------------------------------------------------------------------ #
    # Button / action handlers
    # ------------------------------------------------------------------ #

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "btn-confirm":
            self._launch()
        elif event.button.id == "btn-back":
            self.action_go_back()
        elif event.button.id == "btn-cancel":
            self.app.exit()

    def _launch(self) -> None:
        variables = self._collect_variables()
        from forge.screens.run_screen import RunScreen
        self.app.push_screen(
            RunScreen(
                config=self._config,
                config_path=self.node.config_path,
                variables=variables,
                output_dir=self.output_dir,
            )
        )

    def action_go_back(self) -> None:
        self.app.pop_screen()

    def action_quit_app(self) -> None:
        self.app.exit()
