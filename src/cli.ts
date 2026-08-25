/**
 * cli.ts — Main CLI entry point.
 *
 * Commands:
 *   kiln                         Interactive picker (default)
 *   kiln run --config-id <id>    Headless scaffold
 *   kiln list                    List available configs
 *   kiln validate <file>         Validate a config.json and print typed diagnostics
 */

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import chalk from 'chalk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')) as {
  version: string;
};

/** Commander helper to collect repeatable options into an array */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

export async function run(): Promise<void> {
  const program = new Command();

  program
    .name('kiln')
    .description(chalk.bold('🔥 kiln') + ' — interactive project scaffolding')
    .version(pkg.version, '-v, --version');

  // ── Default action: interactive picker ─────────────────────────────────────
  program
    .option('-o, --output <dir>', 'Output directory (default: cwd)')
    .option('-c, --configs <dir>', 'Extra configs directory')
    .action(async (opts: { output?: string; configs?: string }) => {
      const { runPick } = await import('./commands/pick.js');
      await runPick({
        output: opts.output,
        extraConfigs: opts.configs ? [opts.configs] : [],
      });
    });

  // ── kiln run ───────────────────────────────────────────────────────────────
  program
    .command('run')
    .description('Scaffold a project non-interactively (CI/scripting mode)')
    .requiredOption('--config-id <id>', 'Slash-separated config id, e.g. "react/vite"')
    .option('-o, --output <dir>', 'Output directory (default: cwd)')
    .option('--var <key=value>', 'Set a template variable (repeatable)', collect, [])
    .option('-c, --configs <dir>', 'Extra configs directory')
    .action(
      async (opts: { configId: string; var: string[]; output?: string; configs?: string }) => {
        const { runHeadless } = await import('./commands/run.js');
        await runHeadless({
          configId: opts.configId,
          vars: opts.var,
          output: opts.output,
          extraConfigs: opts.configs ? [opts.configs] : [],
        });
      }
    );

  // ── kiln list ──────────────────────────────────────────────────────────────
  program
    .command('list')
    .description('List all available scaffold configs')
    .option('-c, --configs <dir>', 'Extra configs directory')
    .action(async (opts: { configs?: string }) => {
      const { runList } = await import('./commands/list.js');
      runList({ extraConfigs: opts.configs ? [opts.configs] : [] });
    });

  // ── kiln validate ──────────────────────────────────────────────────────────
  program
    .command('validate <file>')
    .description('Validate a kiln config.json/config.jsonc file')
    .action(async (file: string) => {
      const { runValidate } = await import('./commands/validate.js');
      runValidate(file);
    });

  await program.parseAsync(process.argv);
}