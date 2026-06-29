"""forge/app.py — Main Textual application."""

from __future__ import annotations

from pathlib import Path

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.widgets import Footer, Header

from forge.engine.config_loader import ConfigLoader
from forge.engine.plugin_loader import PluginLoader
from forge.engine.templates_loader import TemplateLoader
from forge.screens.select_screen import SelectScreen


class ForgeApp(App):
    """Forge — interactive project scaffolding TUI."""

    TITLE = "🔨 Forge"
    SUB_TITLE = "Project Scaffolding Tool"

    CSS = """
    Screen {
        background: $surface;
    }

    Header {
        background: $primary;
        color: $text;
        text-style: bold;
    }

    Footer {
        background: $primary-darken-2;
    }

    .breadcrumb {
        background: $primary-darken-1;
        color: $text-muted;
        padding: 0 2;
        height: 1;
    }

    .breadcrumb .active {
        color: $accent;
        text-style: bold;
    }

    ListView {
        border: solid $primary;
        background: $surface;
        padding: 0 1;
    }

    ListItem {
        padding: 0 1;
    }

    ListItem:hover {
        background: $primary-darken-1;
    }

    ListItem.-highlighted {
        background: $accent;
        color: $text;
    }

    .panel-title {
        text-style: bold;
        color: $accent;
        padding: 0 1;
    }

    .tag {
        background: $primary;
        color: $text-muted;
        padding: 0 1;
        margin: 0 1 0 0;
    }

    Input {
        margin: 0 1;
    }

    Button {
        margin: 1 1 0 0;
    }

    Button.primary {
        background: $accent;
    }

    Button.danger {
        background: $error;
    }

    RichLog {
        border: solid $primary;
        padding: 0 1;
        background: $surface-darken-1;
    }

    .status-ok {
        color: $success;
    }

    .status-error {
        color: $error;
    }

    .status-running {
        color: $warning;
    }
    """

    BINDINGS = [
        Binding("q", "quit", "Quit", priority=True),
    ]

    def __init__(
        self,
        output_dir: Path,
        extra_config_dirs: list[Path] | None = None,
        extra_plugin_dirs: list[Path] | None = None,
        extra_template_dirs: list[Path] | None = None,
    ):
        super().__init__()
        self.output_dir = output_dir
        self.loader = ConfigLoader(extra_config_dirs=extra_config_dirs or [])
        self.plugin_loader = PluginLoader(extra_plugin_dirs=extra_plugin_dirs or [])
        self.template_loader = TemplateLoader(extra_template_dirs=extra_template_dirs or [])

    def on_mount(self) -> None:
        self.push_screen(
            SelectScreen(
                loader=self.loader,
                output_dir=self.output_dir,
                plugin_loader=self.plugin_loader,
                template_loader=self.template_loader,
            )
        )

    def compose(self) -> ComposeResult:
        yield Header()
        yield Footer()
