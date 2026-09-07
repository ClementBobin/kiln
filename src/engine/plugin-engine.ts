/**
 * plugin-engine.ts
 *
 * Executes a resolved plugin against a target project directory.
 *
 * Execution order
 * ───────────────
 *   1. Install npm dependencies   (if manifest.dependencies present)
 *   2. pre_apply steps
 *   3. apply  (local | script | command)
 *   4. post_apply steps
 *
 * apply.type === 'local'
 *   All files in the plugin directory (excluding plugin.json itself and any
 *   .py / .ts / .js scripts listed in apply.file) are copied into targetDir
 *   with {{ variable }} interpolation.
 *
 * apply.type === 'script'
 *   The script named in apply.file is executed inside targetDir.
 *   Python scripts (.py) → `python3 <script>`
 *   TypeScript scripts (.ts) → `npx tsx <script>`
 *   Other → executed directly.
 *
 * apply.type === 'command'
 *   apply.commands[] are run in targetDir, same as source.commands.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execa } from 'execa';
import type { ScaffoldEvent, ScaffoldEventStatus } from '../../types/index.js';
import type { PluginApplyOptions, CommandStep } from '../../types/index.js';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function interpolate(str: string, vars: Record<string, string>): string {
  return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? _);
}

async function runCommand(cmd: string, cwd: string): Promise<number> {
  const shell: string | true = process.platform === 'win32' ? true : '/bin/sh';
  const child = execa(cmd, { cwd, shell, stdio: 'inherit' });
  try {
    await child;
    return 0;
  } catch (err: unknown) {
    return (err as { exitCode?: number }).exitCode ?? 1;
  }
}

function copyWithInterpolation(
  src: string,
  dest: string,
  vars: Record<string, string>,
  excludeNames: Set<string>,
): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (excludeNames.has(entry.name)) continue;
    const srcPath  = path.join(src, entry.name);
    const destName = interpolate(entry.name, vars);
    const destPath = path.join(dest, destName);
    if (entry.isDirectory()) {
      copyWithInterpolation(srcPath, destPath, vars, new Set());
    } else {
      const content = interpolate(fs.readFileSync(srcPath, 'utf8'), vars);
      fs.writeFileSync(destPath, content, 'utf8');
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Detect package manager in targetDir
// ──────────────────────────────────────────────────────────────────────────────

function detectPm(dir: string): 'npm' | 'yarn' | 'pnpm' | 'bun' {
  if (fs.existsSync(path.join(dir, 'bun.lockb')))         return 'bun';
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml')))    return 'pnpm';
  if (fs.existsSync(path.join(dir, 'yarn.lock')))         return 'yarn';
  return 'npm';
}

function installCmd(pm: string, dep: string): string {
  switch (pm) {
    case 'yarn': return `yarn add ${dep}`;
    case 'pnpm': return `pnpm add ${dep}`;
    case 'bun':  return `bun add ${dep}`;
    default:     return `npm install ${dep}`;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Main export
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Apply a plugin to a target project directory.
 * Yields ScaffoldEvent-shaped events so the CLI can display live progress.
 */
export async function* applyPlugin(
  opts: PluginApplyOptions,
): AsyncGenerator<ScaffoldEvent> {
  const { plugin, targetDir, variables: vars } = opts;
  const { manifest, dir: pluginDir } = plugin;

  const ev = (status: ScaffoldEventStatus, message: string): ScaffoldEvent => ({ status, message });

  yield ev('info', `Applying plugin: ${manifest.name}`);

  if (!fs.existsSync(targetDir)) {
    yield ev('error', `Target directory does not exist: ${targetDir}`);
    return;
  }

  // ── 1. Install npm dependencies ─────────────────────────────────────────
  if (manifest.dependencies?.length) {
    const pm = detectPm(targetDir);
    yield ev('info', `Installing dependencies with ${pm}…`);
    for (const dep of manifest.dependencies) {
      const cmd = installCmd(pm, interpolate(dep, vars));
      yield ev('running', `Install: ${dep}`);
      const code = await runCommand(cmd, targetDir);
      if (code !== 0) {
        yield ev('error', `Failed to install ${dep} (exit ${code})`);
        return;
      }
      yield ev('ok', `Installed: ${dep}`);
    }
  }

  // ── 2. pre_apply ────────────────────────────────────────────────────────
  for (const step of manifest.pre_apply ?? []) {
    yield* runStep(step, vars, targetDir);
    // runStep yields ok/error; stop on error
    // (we can't easily detect an error from a sub-generator, so we let it flow)
  }

  // ── 3. apply ────────────────────────────────────────────────────────────
  const apply = manifest.apply;

  switch (apply.type) {
    case 'local': {
      yield ev('running', 'Copying plugin files…');
      const exclude = new Set(['plugin.json']);
      if (apply.file) exclude.add(apply.file);
      try {
        copyWithInterpolation(pluginDir, targetDir, vars, exclude);
        yield ev('ok', 'Plugin files copied');
      } catch (err: unknown) {
        yield ev('error', `Copy failed: ${(err as Error).message}`);
        return;
      }
      break;
    }

    case 'script': {
      if (!apply.file) {
        yield ev('error', 'apply.type is "script" but no apply.file is specified');
        return;
      }
      const scriptPath = path.join(pluginDir, apply.file);
      if (!fs.existsSync(scriptPath)) {
        yield ev('error', `Script not found: ${scriptPath}`);
        return;
      }
      const ext = path.extname(apply.file).toLowerCase();
      let cmd: string;
      if (ext === '.py')              cmd = `python3 "${scriptPath}"`;
      else if (ext === '.ts')         cmd = `npx tsx "${scriptPath}"`;
      else if (ext === '.js' || ext === '.mjs') cmd = `node "${scriptPath}"`;
      else                            cmd = `"${scriptPath}"`;

      yield ev('running', `Running script: ${apply.file}`);
      const code = await runCommand(cmd, targetDir);
      if (code !== 0) {
        yield ev('error', `Script failed (exit ${code}): ${apply.file}`);
        return;
      }
      yield ev('ok', `Script completed: ${apply.file}`);
      break;
    }

    case 'command': {
      for (const step of apply.commands ?? []) {
        yield* runStep(step, vars, targetDir);
      }
      break;
    }

    default:
      yield ev('warning', `Unknown apply.type: "${(apply as { type: string }).type}" — skipped`);
  }

  // ── 4. post_apply ───────────────────────────────────────────────────────
  for (const step of manifest.post_apply ?? []) {
    yield* runStep(step, vars, targetDir);
  }

  yield ev('info', `Plugin applied: ${manifest.name} ✔`);
}

async function* runStep(
  step: CommandStep,
  vars: Record<string, string>,
  cwd: string,
): AsyncGenerator<ScaffoldEvent> {
  const cmd   = interpolate(step.cmd, vars);
  const label = step.label ? interpolate(step.label, vars) : cmd;
  yield { status: 'running', message: label };
  const code = await runCommand(cmd, cwd);
  if (code !== 0) {
    yield { status: 'error', message: `Step failed (exit ${code}): ${cmd}` };
  } else {
    yield { status: 'ok', message: label };
  }
}