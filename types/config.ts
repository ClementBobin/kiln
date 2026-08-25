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

export type LinterType = 'eslint' | 'biome' | 'oxc' | 'pylint' | 'ruff' | 'ktlint' | 'detekt' | 'swiftlint';

export type FormatterType = 'prettier' | 'biome' | 'black' | 'ruff' | 'ktlint' | 'swiftformat';

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
  description?: string;
  source?: ConfigSource;
  structure?: Structures;
  variables?: ConfigVariable[];
  code_conventions?: CodeConventions;
  post_init?: CommandStep[];
  plugins?: string[];
}