"""forge/screens/run_screen.py — Live execution log screen.

Most steps stream into the log (RichLog) as usual. But any step that shells
out to an external command (the project's own CLI generator, a setup
script, post_init, the build/test/format pipeline, ...) hands the *real*
terminal over to that process instead — via Textual's ``app.suspend()`` —
so interactive prompts/wizards work and the TUI never blocks input. Once
the command finishes, control returns to the TUI and we keep logging.
"""

from __future__ import annotations

import asyncio
import subprocess
from pathlib import Path
from typing import Any

from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal
from textual.screen import Screen
from textual.widgets import Button, Footer, Header, Label, RichLog

from forge.engine.scaffolder import scaffold


class RunScreen(Screen):
    """Streams live log output while scaffolding the project."""

    BINDINGS = [
        Binding("q", "quit_app", "Quit", show=True),
    ]

    def __init__(
        self,
        config: dict[str, Any],
        config_path: Path,
        variables: dict[str, str],
        output_dir: Path,
        plugin_loader=None,
        template_loader=None,
    ):
        super().__init__()
        self.config = config
        self.config_path = config_path
        self.variables = variables
        self.output_dir = output_dir
        self.plugin_loader = plugin_loader
        self.template_loader = template_loader
        self._done = False
        self._error = False

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #

    def compose(self) -> ComposeResult:
        yield Header()
        yield Label("🔨  Scaffolding project…", id="run-title", classes="panel-title")
        yield RichLog(id="log", wrap=True, highlight=True, markup=True)
        yield Horizontal(
            Button("✗  Abort / Quit", id="btn-quit", variant="error"),
            Button("← Back to templates", id="btn-back"),
            id="run-buttons",
        )
        yield Footer()

    def on_mount(self) -> None:
        self.query_one("#btn-back", Button).disabled = True
        asyncio.get_event_loop().create_task(self._run_scaffold())

    # ------------------------------------------------------------------ #
    # Interactive step runner — hands the real terminal to the child
    # process so prompts/wizards work, instead of blocking behind the TUI.
    # ------------------------------------------------------------------ #

    async def _interactive_step_runner(self, cmd: str, cwd: Path, label: str, env: dict[str, str]) -> int:
        log: RichLog = self.query_one("#log", RichLog)
        log.write(f"[yellow]⠋[/yellow]  {label}  [dim](handing over terminal — interact normally)[/dim]")

        import os
        full_env = {**os.environ, **env} if env else None

        # Suspend the TUI (returns the real terminal to the user) for the
        # duration of the command, then resume — this is what keeps the
        # screen from blocking input during installs/wizards.
        with self.app.suspend():
            print(f"\n$ {cmd}\n")
            result = subprocess.run(cmd, shell=True, cwd=str(cwd), env=full_env)
            print()  # spacing before the TUI redraws

        if result.returncode == 0:
            log.write(f"[green]✓[/green]  {label}")
        else:
            log.write(f"[red]✗[/red]  {label} (exit {result.returncode})")
        return result.returncode

    # ------------------------------------------------------------------ #
    # Scaffold runner
    # ------------------------------------------------------------------ #

    async def _run_scaffold(self) -> None:
        log: RichLog = self.query_one("#log", RichLog)

        try:
            async for status, message in scaffold(
                config=self.config,
                config_path=self.config_path,
                variables=self.variables,
                output_dir=self.output_dir,
                plugin_loader=self.plugin_loader,
                template_loader=self.template_loader,
                step_runner=self._interactive_step_runner,
            ):
                if status == "ok":
                    log.write(f"[green]✓[/green]  {message}")
                elif status == "error":
                    log.write(f"[red]✗[/red]  {message}")
                    self._error = True
                elif status == "running":
                    log.write(f"[yellow]⠋[/yellow]  {message}")
                else:  # info
                    log.write(f"   [dim]{message}[/dim]")
        except Exception as e:
            log.write(f"[red bold]Fatal error:[/red bold] {e}")
            self._error = True

        self._done = True
        if self._error:
            log.write("\n[red bold]Scaffolding completed with errors.[/red bold]")
            title_label = self.query_one("#run-title", Label)
            title_label.update("❌  Scaffolding finished with errors")
        else:
            log.write("\n[green bold]✓  All done! Happy coding 🚀[/green bold]")
            title_label = self.query_one("#run-title", Label)
            title_label.update("✅  Project created successfully")

        self.query_one("#btn-back", Button).disabled = False

    # ------------------------------------------------------------------ #
    # Button / action handlers
    # ------------------------------------------------------------------ #

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "btn-quit":
            self.app.exit()
        elif event.button.id == "btn-back":
            # Pop back to select screen (two screens back: run + preview)
            self.app.pop_screen()
            self.app.pop_screen()

    def action_quit_app(self) -> None:
        self.app.exit()
