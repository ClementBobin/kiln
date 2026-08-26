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

export type LinterType = 'eslint' | 'biome' | 'oxc' | 'pylint' | 'ruff' | 'ktlint' | 'detekt' | 'swiftlint' | 'roslyn';

export type FormatterType = 'prettier' | 'biome' | 'black' | 'ruff' | 'ktlint' | 'swiftformat' | 'dotnet-format';

export interface CommandStep {
  cmd: string;
  label?: string;
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
  /** Runtime engine to use. Inferred from source/structure when absent. */
  runtime?: RuntimeName;
  source?: ConfigSource;
  structure?: Structures;
  variables?: ConfigVariable[];
  code_conventions?: CodeConventions;
  post_init?: CommandStep[];
  plugins?: string[];
}
