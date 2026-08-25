/**
 * pick.js — Interactive config picker for kiln CLI.
 *
 * Uses @inquirer/prompts to walk the config tree and collect variables,
 * then runs the scaffolder.
 */

import path from 'node:path';
import fs from 'node:fs';
import { select, input, checkbox } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';

import { buildConfigTree, loadConfigFile } from '../engine/config-loader.js';
import { scaffold } from '../engine/scaffolder.js';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Print a typed diagnostic from config validation */
function printDiagnostics(diagnostics, configPath) {
  if (!diagnostics.length) return;
  console.log();
  for (const d of diagnostics) {
    const prefix =
      d.level === 'error'
        ? chalk.red('  ✖ [error]  ')
        : chalk.yellow('  ⚠ [warning]');
    const loc = d.path && d.path !== configPath ? chalk.dim(` (at ${d.path})`) : '';
    console.log(`${prefix} ${d.message}${loc}`);
  }
  console.log();
}

/** Recursively prompt the user to navigate the tree until a leaf is selected */
async function pickLeaf(node) {
  if (node.isLeaf) return node;

  const choices = (node.children ?? []).map((child) => ({
    name: child.isLeaf ? `  ${child.name}` : `▸ ${child.name}`,
    value: child,
    description: child.isLeaf ? chalk.dim(child.configPath) : chalk.dim('folder'),
  }));

  choices.push({ name: chalk.dim('‹ back'), value: null });

  const chosen = await select({
    message: chalk.bold('Select a template:'),
    choices,
    pageSize: 16,
  });

  if (!chosen) return null; // back
  return pickLeaf(chosen);
}

/** Prompt for each declared variable in the config */
async function collectVariables(variables) {
  const result = {};
  for (const v of variables ?? []) {
    if (v.choices?.length) {
      result[v.key] = await select({
        message: chalk.cyan(`${v.label ?? v.key}:`),
        choices: v.choices.map((c) => ({ name: c, value: c })),
        default: v.default,
      });
    } else {
      result[v.key] = await input({
        message: chalk.cyan(`${v.label ?? v.key}:`),
        default: v.default ?? '',
        validate: v.required
          ? (s) => (s.trim() ? true : `${v.key} is required`)
          : undefined,
      });
    }
  }
  return result;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string}   [opts.output]   - output directory (default: cwd)
 * @param {string[]} [opts.extraConfigs] - extra config dirs
 */
export async function runPick(opts = {}) {
  const outputDir = path.resolve(opts.output ?? process.cwd());

  if (!fs.existsSync(outputDir)) {
    console.error(chalk.red(`✖ Output directory does not exist: ${outputDir}`));
    process.exit(1);
  }

  const tree = buildConfigTree(opts.extraConfigs ?? []);

  if (!tree.children?.length) {
    console.error(chalk.red('✖ No configs found. Check your configs directory.'));
    process.exit(1);
  }

  console.log();
  console.log(chalk.bold.magenta('  🔥 kiln') + chalk.dim(' — project scaffolding'));
  console.log();

  // Walk tree
  let leaf = null;
  let navNode = tree;

  while (!leaf) {
    const picked = await pickLeaf(navNode);
    if (!picked) {
      // user chose "back" at root level → exit
      console.log(chalk.dim('\n  Cancelled.'));
      process.exit(0);
    }
    if (picked.isLeaf) {
      leaf = picked;
    }
  }

  // Load + validate config
  const { config, diagnostics } = loadConfigFile(leaf.configPath);

  if (diagnostics.some((d) => d.level === 'error')) {
    console.log(chalk.red.bold('\n  Config has errors — cannot scaffold:\n'));
    printDiagnostics(diagnostics, leaf.configPath);
    process.exit(1);
  }

  if (diagnostics.some((d) => d.level === 'warning')) {
    console.log(chalk.yellow.bold('  Config warnings:'));
    printDiagnostics(diagnostics, leaf.configPath);
  }

  // Show description
  if (config.description) {
    console.log(chalk.dim(`  ${config.description}\n`));
  }

  // Collect variables
  const variables = await collectVariables(config.variables);

  // Confirm
  const projectName = variables.project_name ?? path.basename(outputDir);
  console.log();
  console.log(
    chalk.bold(`  Scaffolding `) +
      chalk.cyan(config.name) +
      chalk.bold(` into `) +
      chalk.green(outputDir)
  );
  console.log();

  // Run scaffold
  for await (const event of scaffold({
    config,
    configDir: leaf.filePath,
    variables,
    outputDir,
  })) {
    const icons = { running: chalk.yellow('⏳'), ok: chalk.green('✅'), error: chalk.red('✖'), info: chalk.blue('ℹ'), warning: chalk.yellow('⚠') };
    const icon = icons[event.status] ?? '•';
    if (event.status === 'error') {
      console.log(`  ${icon} ${chalk.red(event.message)}`);
    } else if (event.status === 'info') {
      console.log(`  ${icon} ${chalk.dim(event.message)}`);
    } else {
      console.log(`  ${icon} ${event.message}`);
    }
  }

  console.log();
  console.log(chalk.green.bold('  Done! 🎉'));
  console.log();
}
