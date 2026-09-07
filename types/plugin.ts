/**
 * types/plugin.ts
 *
 * Types for the kiln plugin system.
 *
 * Plugins live under plugin/<runtime>/<name>/plugin.json and contain
 * standalone capabilities (auth, ORM, database wiring…) that can be
 * applied on top of an already-scaffolded project.
 */

import type { CommandStep, ConfigVariable } from './config.js';

// ──────────────────────────────────────────────────────────────────────────────
// Plugin manifest  (plugin.json)
// ──────────────────────────────────────────────────────────────────────────────

export type PluginApplyType = 'local' | 'script' | 'command';

export interface PluginApply {
  /** How the plugin's files are applied to the target project. */
  type: PluginApplyType;
  /**
   * local  → all files in the plugin directory (excluding plugin.json) are
   *          copied into the target directory, with {{ var }} interpolation.
   * script → `file` names a script (e.g. setup.py / setup.ts) inside the plugin
   *          directory that is executed in the target directory.
   * command → `commands` are run in the target directory (same as source.commands).
   */
  file?: string;
  commands?: CommandStep[];
}

export interface PluginManifest {
  name: string;
  description?: string;
  tags?: string[];

  variables?: ConfigVariable[];

  /**
   * npm/pip packages to install before applying the plugin.
   * Strings are passed directly to the package manager
   * (e.g. "prisma --save-dev", "@prisma/client").
   */
  dependencies?: string[];

  /** Steps run BEFORE the apply phase (env, init commands…). */
  pre_apply?: CommandStep[];

  /** How the plugin's files / scripts are applied. */
  apply: PluginApply;

  /** Steps run AFTER the apply phase (package installs, db migrations…). */
  post_apply?: CommandStep[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Resolved plugin (after loading from disk)
// ──────────────────────────────────────────────────────────────────────────────

export interface ResolvedPlugin {
  /** Display name from plugin.json */
  name: string;
  /** Absolute path to the plugin directory */
  dir: string;
  /** Absolute path to plugin.json */
  manifestPath: string;
  /** Parsed and validated manifest */
  manifest: PluginManifest;
  /**
   * Logical id — slash-separated path segments relative to the plugin root,
   * e.g. "dotnet/jwt" or "nodejs/prisma".
   */
  id: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Plugin tree node (mirrors ConfigTreeNode for the UI)
// ──────────────────────────────────────────────────────────────────────────────

export interface PluginTreeNode {
  name: string;
  /** Absolute path to the directory */
  dirPath: string;
  isLeaf: boolean;
  children?: PluginTreeNode[];
  /** Only on leaf nodes */
  plugin?: ResolvedPlugin;
}

// ──────────────────────────────────────────────────────────────────────────────
// Apply options
// ──────────────────────────────────────────────────────────────────────────────

export interface PluginApplyOptions {
  plugin: ResolvedPlugin;
  /** Absolute path to the target project directory */
  targetDir: string;
  variables: Record<string, string>;
}