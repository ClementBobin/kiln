/**
 * run.ts — Headless (non-interactive) scaffold command.
 * Used by: kiln run --config-id react/vite --var project_name=my-app
 */

import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import chalk from 'chalk';

import { buildConfigTree, findNodeById, loadConfigFile } from '../engine/config-loader.js';
import { scaffold } from '../engine/scaffolder.js';
import type { Diagnostic, HeadlessOptions, ScaffoldEventStatus } from '../../types/index.js';
import console from 'node:console';
import process from 'node:process';

/** Print a typed diagnostic */
function printDiagnostic(d: Diagnostic): void {
  if (d.level === 'error') {
    console.error(
      chalk.red(`  ✖ [error]   ${d.message}`) + (d.path ? chalk.dim(` (${d.path})`) : '')
    );
  } else {
    console.warn(
      chalk.yellow(`  ⚠ [warning] ${d.message}`) + (d.path ? chalk.dim(` (${d.path})`) : '')
    );
  }
}

async function promptLine(label: string, defaultVal: string): Promise<string> {
  if (!process.stdin.isTTY) return defaultVal;
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`  ${label} [${defaultVal}]: `, (ans) => {
      rl.close();
      resolve(ans.trim() || defaultVal);
    });
  });
}

export async function runHeadless(opts: HeadlessOptions): Promise<void> {
  const outputDir = path.resolve(opts.output ?? process.cwd());

  if (!fs.existsSync(outputDir)) {
    console.error(chalk.red(`✖ Output directory does not exist: ${outputDir}`));
    process.exit(1);
  }

  const tree = buildConfigTree(opts.extraConfigs ?? []);
  const leaf = findNodeById(tree, opts.configId);

  if (!leaf) {
    console.error(chalk.red(`✖ Unknown config id: "${opts.configId}"`));
    console.error(chalk.dim('  Run `kiln list` to see available config ids.'));
    process.exit(1);
  }

  const { config, diagnostics } = loadConfigFile(leaf.configPath!);

  // Print diagnostics
  for (const d of diagnostics) {
    printDiagnostic(d);
  }

  if (diagnostics.some((d) => d.level === 'error')) {
    console.error(chalk.red('\n✖ Config has errors, cannot scaffold.'));
    process.exit(1);
  }

  if (!config) {
    console.error(chalk.red('✖ Config could not be loaded.'));
    process.exit(1);
  }

  // Parse --var key=value flags
  const variables: Record<string, string> = {};
  for (const v of opts.vars ?? []) {
    if (!v.includes('=')) {
      console.error(chalk.red(`✖ Invalid --var "${v}" — expected key=value`));
      process.exit(1);
    }
    const [key, ...rest] = v.split('=');
    variables[key.trim()] = rest.join('=');
  }

  // Prompt for any missing declared variables (if TTY available)
  for (const vDef of config.variables ?? []) {
    if (vDef.key && !(vDef.key in variables)) {
      variables[vDef.key] = await promptLine(vDef.label ?? vDef.key, vDef.default ?? '');
    }
  }

  console.log();
  console.log(chalk.bold(`▶ Scaffolding ${chalk.cyan(config.name)} into ${chalk.green(outputDir)}`));
  console.log();

  const icons: Record<ScaffoldEventStatus, string> = {
    running: '⏳',
    ok: '✅',
    error: '✖',
    info: 'ℹ',
    warning: '⚠',
  };

  let hasError = false;

  for await (const event of scaffold({
    config,
    configDir: leaf.filePath,
    variables,
    outputDir,
  })) {
    const icon = icons[event.status] ?? '•';
    if (event.status === 'error') {
      console.error(`${chalk.red(icon)} ${chalk.red(event.message)}`);
      hasError = true;
    } else if (event.status === 'info') {
      console.log(`${chalk.blue(icon)} ${chalk.dim(event.message)}`);
    } else {
      console.log(`${icon} ${event.message}`);
    }
  }

  process.exit(hasError ? 1 : 0);
}