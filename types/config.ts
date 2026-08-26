/**
 * types/config.ts
 *
 * All shared types for kiln config files (config.json / config.jsonc).
 */

import type { Structures } from "./index.js";

// ──────────────────────────────────────────────────────────────────────────────
// Config schema types
// ──────────────────────────────────────────────────────────────────────────────

export type SourceType = 'command' | 'local' | 'github' | 'script';

export type RuntimeName = 'node' | 'dotnet' | 'kotlin' | 'android';

export type LinterType =
  | 'eslint'
  | 'biome'
  | 'oxc'
  | 'pylint'
  | 'ruff'
  | 'ktlint'
  | 'detekt'
  | 'swiftlint'
  | 'roslyn';

export type FormatterType =
  | 'prettier'
  | 'biome'
  | 'black'
  | 'ruff'
  | 'ktlint'
  | 'swiftformat'
  | 'dotnet-format';

/**
 * A single shell step used in pre_init / check_dependencies / source.commands / post_init.
 *
 * `override: true`  — this user-supplied step replaces the runtime default for
 *                     this position rather than being appended after it.
 */
export interface CommandStep {
  cmd: string;
  label?: string;
  /**
   * When `true` inside pre_init / check_dependencies / post_init, this step
   * replaces (rather than appends to) the runtime's built-in default steps.
   * Has no effect inside source.commands — those are always additive.
   */
  override?: boolean;
}

export interface ConfigSource {
  type: SourceType;
  /** For type === 'command' */
  commands?: CommandStep[];
  /** For type === 'github' */
  repo?: string;
  ref?: string;
  /** For type === 'local' */
  path?: string;
}

export interface ConfigVariable {
  key: string;
  label?: string;
  default?: string;
  choices?: string[];
  required?: boolean;
}

export interface LinterConfig {
  enabled?: boolean;
  type?: LinterType;
  config_file?: string;
}

export interface FormatterConfig {
  enabled?: boolean;
  type?: FormatterType;
}

export interface CommitConventionsConfig {
  enabled?: boolean;
  tool?: string;
  config_file?: string;
  hooks?: string;
}

export interface CodeConventions {
  editorconfig?: boolean;
  linter?: LinterConfig;
  formatter?: FormatterConfig;
  commit_conventions?: CommitConventionsConfig;
}

export interface KilnConfig {
  name: string;
  tags?: string[];
  description?: string;

  /**
   * Steps that run BEFORE scaffolding begins (env setup, directory creation…).
   * `null`           → skip all defaults and run nothing.
   * `[]` / absent    → run runtime defaults only.
   * Steps with `override: true` replace defaults; others append after them.
   */
  pre_init?: CommandStep[] | null;

  /**
   * Checks that verify required tools are available before scaffolding.
   * Each `cmd` should exit 0 when the tool is present (e.g. `dotnet --version`).
   * Same null / override semantics as pre_init.
   */
  check_dependencies?: CommandStep[] | null;

  /** Runtime engine to use. Inferred from source/structure/tags when absent. */
  runtime?: RuntimeName;

  source?: ConfigSource;
  structure?: Structures;
  variables?: ConfigVariable[];
  code_conventions?: CodeConventions;

  /**
   * Steps that run AFTER scaffolding (restore, install, format…).
   * Same null / override semantics as pre_init.
   */
  post_init?: CommandStep[] | null;

  plugins?: string[];
}