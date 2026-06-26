{
  description = "🔨 Forge — Interactive TUI project scaffolding tool";

  inputs = {
    nixpkgs.url     = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        python = pkgs.python311;

        # ── commentjson as a Nix derivation (not yet in nixpkgs) ───────
        commentjson = python.pkgs.buildPythonPackage rec {
          pname   = "commentjson";
          version = "0.9.0";
          format  = "setuptools";

          src = python.pkgs.fetchPypi {
            inherit pname version;
            sha256 = "sha256-MKiTlHYzCMGJGFjBBkHdmNqDLKvFpWqHMJi2t9zhlmY=";
          };

          propagatedBuildInputs = [ python.pkgs.lark ];
          doCheck = false;
        };

        # ── Python environment ──────────────────────────────────────────
        pythonEnv = python.withPackages (ps: with ps; [
          # runtime
          textual
          typer
          gitpython
          httpx
          rich
          jinja2
          commentjson

          # dev / test
          pytest
          pytest-asyncio
          hatchling
          pip
        ]);

        # ── forge package derivation ────────────────────────────────────
        kilnPkg = python.pkgs.buildPythonApplication {
          pname   = "kiln-cli";
          version = "0.1.0";
          format  = "pyproject";

          src = ./.;

          nativeBuildInputs = [ python.pkgs.hatchling ];

          propagatedBuildInputs = [
            python.pkgs.textual
            python.pkgs.typer
            python.pkgs.gitpython
            python.pkgs.httpx
            python.pkgs.rich
            python.pkgs.jinja2
            commentjson
          ];

          # Tests require a TTY; skip during nix build, run via `nix run .#test`
          doCheck = false;

          meta = {
            description = "🔥 Kiln — Interactive TUI project scaffolding tool";
            license     = pkgs.lib.licenses.mit;
            mainProgram = "kiln";
          };
        };

      in {
        # ── Packages ──────────────────────────────────────────────────
        packages = {
          default     = kilnPkg;
          forge       = kilnPkg;
        };

        # ── Apps (nix run) ─────────────────────────────────────────────
        apps = {
          default = flake-utils.lib.mkApp {
            drv  = kilnPkg;
            name = "kiln";
          };

          # Run the test suite: nix run .#test
          test = {
            type    = "app";
            program = toString (pkgs.writeShellScript "kiln-test" ''
              cd ${./.}
              ${pythonEnv}/bin/pytest tests/ -v "$@"
            '');
          };
        };

        # ── Dev shell (nix develop) ────────────────────────────────────
        devShells.default = pkgs.mkShell {
          name = "kiln-dev";

          packages = [
            pythonEnv
            pkgs.git
            pkgs.just
            pkgs.ruff        # linter / formatter
            pkgs.ripgrep
          ];

          shellHook = ''
            echo ""
            echo "  🔨  kiln dev shell (flake)"
            echo "  Python  : $(python --version)"
            echo "  Git     : $(git --version)"
            echo ""
            echo "  Commands:"
            echo "    kiln              – launch the TUI"
            echo "    pytest            – run the test suite"
            echo "    nix run .#test    – run tests via nix"
            echo "    just fmt          – format with ruff"
            echo "    just lint         – lint with ruff"
            echo ""

            # Editable install so changes are reflected immediately
            pip install -e . --quiet --no-deps 2>/dev/null || true
          '';
        };
      }
    );
}
