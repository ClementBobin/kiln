/**
 * pick.ts — Interactive picker for kiln CLI.
 *
 * Navigation structure
 * ────────────────────
 *   Main menu
 *   ├─ Template  → template tree (with ‹ back → main menu)
 *   └─ Plugin    → plugin tree   (with ‹ back → main menu)
 *
 * Every level of the tree exposes a ‹ back choice.
 * Choosing ‹ back at the top level of a tree returns to the main menu.
 * Choosing ‹ back in the main menu cancels and exits.
 */

import path from 'node:path';
import fs from 'node:fs';
import { select, input } from '@inquirer/prompts';
import chalk from 'chalk';
import process from 'node:process';
import console from 'node:console';

import { buildConfigTree, loadConfigFile } from '../engine/config-loader.js';
import { buildPluginTree, loadPluginManifest } from '../engine/plugin-loader.js';
import { scaffold } from '../engine/runtimes/index.js';
import { applyPlugin } from '../engine/plugin-engine.js';

import type {
  Diagnostic,
  TreeNode,
  PluginTreeNode,
  ConfigVariable,
  PickOptions,
  ScaffoldEventStatus,
  ResolvedPlugin,
} from '../../types/index.js';

// ──────────────────────────────────────────────────────────────────────────────
// Sentinel — returned by pickers when the user chose ‹ back
// ──────────────────────────────────────────────────────────────────────────────

const BACK = Symbol('BACK');
type Back = typeof BACK;

// ──────────────────────────────────────────────────────────────────────────────
// Shared UI helpers
// ──────────────────────────────────────────────────────────────────────────────

const STATUS_ICONS: Record<ScaffoldEventStatus, string> = {
  running: chalk.yellow('⏳'),
  ok:      chalk.green('✅'),
  error:   chalk.red('✖'),
  info:    chalk.blue('ℹ'),
  warning: chalk.yellow('⚠'),
};

function printDiagnostics(diagnostics: Diagnostic[], filePath: string): void {
  if (!diagnostics.length) return;
  console.log();
  for (const d of diagnostics) {
    const prefix =
      d.level === 'error'
        ? chalk.red('  ✖ [error]  ')
        : chalk.yellow('  ⚠ [warning]');
    const loc = d.path && d.path !== filePath ? chalk.dim(` (at ${d.path})`) : '';
    console.log(`${prefix} ${d.message}${loc}`);
  }
  console.log();
}

function printEvent(status: ScaffoldEventStatus, message: string): void {
  const icon = STATUS_ICONS[status] ?? '•';
  if (status === 'error') {
    console.log(`  ${icon} ${chalk.red(message)}`);
  } else if (status === 'info') {
    console.log(`  ${icon} ${chalk.dim(message)}`);
  } else {
    console.log(`  ${icon} ${message}`);
  }
}

/** Prompt for each declared variable. */
async function collectVariables(
  variables: ConfigVariable[] | undefined,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const v of variables ?? []) {
    if (v.choices?.length) {
      result[v.key] = await select<string>({
        message: chalk.cyan(`${v.label ?? v.key}:`),
        choices: v.choices.map((c) => ({ name: c, value: c })),
        default: v.default,
      });
    } else {
      result[v.key] = await input({
        message: chalk.cyan(`${v.label ?? v.key}:`),
        default: v.default ?? '',
        validate: v.required
          ? (s: string) => (s.trim() ? true : `${v.key} is required`)
          : undefined,
      });
    }
  }
  return result;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main menu
// ──────────────────────────────────────────────────────────────────────────────

type MainChoice = 'template' | 'plugin';

async function mainMenu(): Promise<MainChoice | Back> {
  const choice = await select<MainChoice | null>({
    message: chalk.bold('What would you like to do?'),
    choices: [
      { name: '📦  Scaffold a template', value: 'template' as MainChoice,
        description: chalk.dim('Create a new project from a template') },
      { name: '🔌  Apply a plugin',      value: 'plugin' as MainChoice,
        description: chalk.dim('Add a capability to an existing project') },
      { name: chalk.dim('✕  Exit'),      value: null,
        description: '' },
    ],
    pageSize: 6,
  });
  return choice ?? BACK;
}

// ──────────────────────────────────────────────────────────────────────────────
// Template picker
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Walk the config tree, presenting one level at a time.
 * Returns the selected leaf node, or BACK if the user backed out to the top.
 */
async function pickTemplateLeaf(
  node: TreeNode,
  depth: number = 0,
): Promise<TreeNode | Back> {
  if (node.isLeaf) return node;

  const choices = (node.children ?? []).map((child) => ({
    name: child.isLeaf ? `  ${child.name}` : `▸ ${child.name}`,
    value: child as TreeNode | null,
    description: child.isLeaf
      ? chalk.dim(child.configPath ?? '')
      : chalk.dim('folder'),
  }));

  const backLabel = depth === 0
    ? chalk.dim('‹ Main menu')
    : chalk.dim('‹ Back');
  choices.push({ name: backLabel, value: null, description: '' });

  const chosen = await select<TreeNode | null>({
    message: chalk.bold('Select a template:'),
    choices,
    pageSize: 16,
  });

  if (!chosen) return BACK;
  if (chosen.isLeaf) return chosen;

  // Go deeper; if user backs out from deeper level, show this level again
  while (true) {
    const result = await pickTemplateLeaf(chosen, depth + 1);
    if (result !== BACK) return result;
    // Re-show this level
    return pickTemplateLeaf(node, depth);
  }
}

async function runTemplate(outputDir: string, extraConfigs: string[]): Promise<void> {
  const tree = buildConfigTree(extraConfigs);

  if (!tree.children?.length) {
    console.error(chalk.red('✖ No templates found. Check your configs directory.'));
    return;
  }

  while (true) {
    const result = await pickTemplateLeaf(tree);
    if (result === BACK) return; // back to main menu

    const leaf = result as TreeNode;

    // Load + validate
    const { config, diagnostics } = loadConfigFile(leaf.configPath!);

    if (diagnostics.some((d) => d.level === 'error')) {
      console.log(chalk.red.bold('\n  Config has errors — cannot scaffold:\n'));
      printDiagnostics(diagnostics, leaf.configPath!);
      continue; // let user pick another
    }

    if (diagnostics.some((d) => d.level === 'warning')) {
      console.log(chalk.yellow.bold('  Config warnings:'));
      printDiagnostics(diagnostics, leaf.configPath!);
    }

    if (!config) {
      console.error(chalk.red('✖ Config could not be loaded.'));
      continue;
    }

    if (config.description) {
      console.log(chalk.dim(`\n  ${config.description}\n`));
    }

    const variables = await collectVariables(config.variables);

    console.log();
    console.log(
      chalk.bold('  Scaffolding ') +
        chalk.cyan(config.name) +
        chalk.bold(' into ') +
        chalk.green(outputDir),
    );
    console.log();

    for await (const event of scaffold({
      config,
      configDir: leaf.filePath,
      variables,
      outputDir,
    })) {
      printEvent(event.status, event.message);
    }

    console.log();
    console.log(chalk.green.bold('  Done! 🎉'));
    console.log();
    return; // finished — exit the command
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Plugin picker
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Walk the plugin tree, presenting one level at a time.
 * Returns the selected plugin, or BACK.
 */
async function pickPluginLeaf(
  node: PluginTreeNode,
  depth: number = 0,
): Promise<ResolvedPlugin | Back> {
  if (node.isLeaf) return node.plugin ?? BACK;

  const choices = (node.children ?? []).map((child) => ({
    name: child.isLeaf ? `  ${child.name}` : `▸ ${child.name}`,
    value: child as PluginTreeNode | null,
    description: child.isLeaf
      ? chalk.dim(child.plugin?.manifest.description ?? child.plugin?.id ?? '')
      : chalk.dim('folder'),
  }));

  const backLabel = depth === 0 ? chalk.dim('‹ Main menu') : chalk.dim('‹ Back');
  choices.push({ name: backLabel, value: null, description: '' });

  const chosen = await select<PluginTreeNode | null>({
    message: chalk.bold('Select a plugin:'),
    choices,
    pageSize: 16,
  });

  if (!chosen) return BACK;

  if (chosen.isLeaf) {
    return chosen.plugin ?? BACK;
  }

  while (true) {
    const result = await pickPluginLeaf(chosen, depth + 1);
    if (result !== BACK) return result;
    return pickPluginLeaf(node, depth);
  }
}

async function runPlugin(outputDir: string, extraPlugins: string[]): Promise<void> {
  const tree = buildPluginTree(extraPlugins);

  if (!tree.children?.length) {
    console.error(chalk.red('✖ No plugins found. Check your plugin directory.'));
    return;
  }

  while (true) {
    const result = await pickPluginLeaf(tree);
    if (result === BACK) return; // back to main menu

    const plugin = result as ResolvedPlugin;

    // Re-validate manifest freshly (loadPluginManifest was already called by
    // buildPluginTree, but we want diagnostics shown to the user)
    const { diagnostics } = loadPluginManifest(plugin.manifestPath, plugin.dir);
    if (diagnostics.some((d) => d.level === 'error')) {
      printDiagnostics(diagnostics, plugin.manifestPath);
      continue;
    }

    if (plugin.manifest.description) {
      console.log(chalk.dim(`\n  ${plugin.manifest.description}\n`));
    }

    // Ask which directory to apply the plugin into
    const targetDir = await input({
      message: chalk.cyan('Target project directory:'),
      default: outputDir,
      validate: (s: string) =>
        fs.existsSync(s.trim()) ? true : `Directory not found: ${s.trim()}`,
    });

    const variables = await collectVariables(plugin.manifest.variables);

    console.log();
    console.log(
      chalk.bold('  Applying ') +
        chalk.cyan(plugin.manifest.name) +
        chalk.bold(' to ') +
        chalk.green(targetDir.trim()),
    );
    console.log();

    for await (const event of applyPlugin({
      plugin,
      targetDir: path.resolve(targetDir.trim()),
      variables,
    })) {
      printEvent(event.status, event.message);
    }

    console.log();
    console.log(chalk.green.bold('  Plugin applied! 🎉'));
    console.log();
    return;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────────────────────────────────────

export async function runPick(opts: PickOptions = {}): Promise<void> {
  const outputDir   = path.resolve(opts.output ?? process.cwd());
  const extraConfigs  = opts.extraConfigs ?? [];
  const extraPlugins  = opts.extraPlugins  ?? [];

  console.log();
  console.log(chalk.bold.magenta('  🔥 kiln') + chalk.dim(' — project scaffolding'));
  console.log();

  while (true) {
    const choice = await mainMenu();

    if (choice === BACK) {
      console.log(chalk.dim('\n  Bye!\n'));
      process.exit(0);
    }

    if (choice === 'template') {
      if (!fs.existsSync(outputDir)) {
        console.error(chalk.red(`\n✖ Output directory does not exist: ${outputDir}\n`));
        continue;
      }
      await runTemplate(outputDir, extraConfigs);
      return;
    }

    if (choice === 'plugin') {
      await runPlugin(outputDir, extraPlugins);
      return;
    }
  }
}