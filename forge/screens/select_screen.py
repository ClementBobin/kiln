"""forge/screens/select_screen.py — Template selection screen with breadcrumb."""

from __future__ import annotations

from pathlib import Path

from textual.app import ComposeResult
from textual.binding import Binding
from textual.reactive import reactive
from textual.screen import Screen
from textual.widgets import Footer, Header, Label, ListItem, ListView, Static

from forge.engine.config_loader import ConfigLoader, TreeNode


class BreadcrumbBar(Static):
    """Shows the current navigation path."""

    crumbs: reactive[list[str]] = reactive([], recompose=True)

    def render(self) -> str:
        if not self.crumbs:
            return "[dim]Templates[/dim]"
        parts = ["[dim]Templates[/dim]"] + [
            f"[bold cyan]{c}[/bold cyan]" for c in self.crumbs
        ]
        return " [dim]›[/dim] ".join(parts)


class SelectScreen(Screen):
    """Recursive template-tree navigation screen."""

    BINDINGS = [
        Binding("up,k", "cursor_up", "Up", show=False),
        Binding("down,j", "cursor_down", "Down", show=False),
        Binding("enter", "select", "Select"),
        Binding("escape,backspace", "go_back", "Back"),
        Binding("q", "quit_app", "Quit"),
    ]

    def __init__(
        self,
        loader: ConfigLoader,
        output_dir: Path,
        plugin_loader=None,
        template_loader=None,
    ):
        super().__init__()
        self.loader = loader
        self.output_dir = output_dir
        self.plugin_loader = plugin_loader
        self.template_loader = template_loader
        self._nav_stack: list[TreeNode] = []  # stack of parent nodes
        self._current_children: list[TreeNode] = []

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #

    def compose(self) -> ComposeResult:
        yield Header()
        yield BreadcrumbBar(id="breadcrumb")
        yield Label("", id="empty-hint")
        yield ListView(id="list-view")
        yield Footer()

    def on_mount(self) -> None:
        self._show_level(self.loader.get_tree().children)

    # ------------------------------------------------------------------ #
    # Navigation helpers
    # ------------------------------------------------------------------ #

    def _show_level(self, children: list[TreeNode]) -> None:
        self._current_children = children
        lv: ListView = self.query_one("#list-view", ListView)
        lv.clear()

        hint: Label = self.query_one("#empty-hint", Label)

        if not children:
            hint.update("[dim]No templates found. Add configs to ~/.forge/configs/[/dim]")
            return
        hint.update("")

        for node in children:
            icon = "📄" if node.is_leaf else "📁"
            lv.append(ListItem(Label(f"{icon}  {node.name}")))

        # Update breadcrumb
        bc: BreadcrumbBar = self.query_one("#breadcrumb", BreadcrumbBar)
        bc.crumbs = [n.name for n in self._nav_stack]
        lv.focus()

    def _current_node(self) -> TreeNode | None:
        lv: ListView = self.query_one("#list-view", ListView)
        idx = lv.index
        if idx is None or idx >= len(self._current_children):
            return None
        return self._current_children[idx]

    # ------------------------------------------------------------------ #
    # Actions
    # ------------------------------------------------------------------ #

    def action_cursor_up(self) -> None:
        self.query_one("#list-view", ListView).action_scroll_up()

    def action_cursor_down(self) -> None:
        self.query_one("#list-view", ListView).action_scroll_down()

    def action_select(self) -> None:
        node = self._current_node()
        if node is None:
            return

        if node.is_leaf:
            # Navigate to preview
            from forge.screens.preview_screen import PreviewScreen
            self.app.push_screen(
                PreviewScreen(
                    node=node,
                    output_dir=self.output_dir,
                    plugin_loader=self.plugin_loader,
                    template_loader=self.template_loader,
                )
            )
        else:
            # Drill down
            self._nav_stack.append(node)
            self._show_level(node.children)

    def action_go_back(self) -> None:
        if self._nav_stack:
            self._nav_stack.pop()
            parent_children = (
                self._nav_stack[-1].children
                if self._nav_stack
                else self.loader.get_tree().children
            )
            self._show_level(parent_children)
        else:
            self.app.exit()

    def action_quit_app(self) -> None:
        self.app.exit()

    # Map ListView selection event to our action_select
    def on_list_view_selected(self, event: ListView.Selected) -> None:
        self.action_select()
