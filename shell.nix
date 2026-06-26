{ pkgs ? import <nixpkgs> {} }:

let
  # Python with all runtime + dev dependencies available as packages
  python = pkgs.python311;

  pythonEnv = python.withPackages (ps: with ps; [
    # ── Runtime dependencies ──────────────────────────────────────────
    textual          # TUI framework
    typer            # CLI entry point
    gitpython        # git operations
    httpx            # async HTTP (GitHub availability check)
    rich             # terminal rendering
    jinja2           # template variable interpolation

    # commentjson may not be in nixpkgs; we include it via pip below.
    # If your nixpkgs has it, uncomment: commentjson

    # ── Dev / test dependencies ───────────────────────────────────────
    pytest
    pytest-asyncio

    # ── Build tooling ─────────────────────────────────────────────────
    hatchling
    pip
  ]);

in pkgs.mkShell {
  name = "kiln-dev";

  packages = [
    pythonEnv

    # System tools expected by forge at runtime
    pkgs.git

    # Optional but recommended dev tools
    pkgs.just          # task runner (see justfile)
    pkgs.ripgrep       # fast search
  ];

  # ── Environment variables ─────────────────────────────────────────────
  shellHook = ''
    echo ""
    echo "  🔨  kiln dev shell"
    echo "  Python  : $(python --version)"
    echo "  Git     : $(git --version)"
    echo ""

    # Install commentjson (not yet in nixpkgs stable) into a local venv
    # so we don't pollute the system store.
    VENV_DIR="$PWD/.venv"

    if [ ! -d "$VENV_DIR" ]; then
      echo "  → Creating local venv for commentjson..."
      python -m venv "$VENV_DIR" --system-site-packages
      "$VENV_DIR/bin/pip" install --quiet commentjson
      echo "  ✓ venv ready"
    fi

    # Prepend venv to PATH so its commentjson is found first
    export PATH="$VENV_DIR/bin:$PATH"
    export PYTHONPATH="$VENV_DIR/lib/python3.11/site-packages:$PYTHONPATH"

    # Install forge itself in editable mode (once)
    if [ ! -f "$VENV_DIR/.kiln_installed" ]; then
      echo "  → Installing kiln in editable mode..."
      "$VENV_DIR/bin/pip" install --quiet -e ".[dev]"
      touch "$VENV_DIR/.kiln_installed"
      echo "  ✓ kiln installed"
    fi

    echo "  Commands:"
    echo "    kiln           – launch the TUI"
    echo "    mkp            – alias for kiln"
    echo "    pytest         – run the test suite"
    echo "    just fmt       – format with ruff"
    echo "    just lint      – lint with ruff"
    echo ""
  '';
}
