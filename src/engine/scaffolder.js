/**
 * scaffolder.js
 *
 * Executes scaffold steps for a given config, emitting status events.
 * Mirrors the Python forge/engine/scaffolder.py logic.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execa } from 'execa';

// ──────────────────────────────────────────────────────────────────────────────
// Template interpolation  {{variable}}
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} str
 * @param {Record<string,string>} vars
 * @returns {string}
 */
function interpolate(str, vars) {
  return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? _);
}

// ──────────────────────────────────────────────────────────────────────────────
// Step runner
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Run a shell command, streaming stdio directly to the terminal.
 * @param {string} cmd
 * @param {string} cwd
 * @returns {Promise<number>} exit code
 */
async function runCommand(cmd, cwd) {
  const shell = process.platform === 'win32' ? true : '/bin/sh';
  const child = execa(cmd, { cwd, shell, stdio: 'inherit' });
  try {
    await child;
    return 0;
  } catch (err) {
    return err.exitCode ?? 1;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Git helpers
// ──────────────────────────────────────────────────────────────────────────────

async function gitInit(cwd) {
  await execa('git', ['init'], { cwd, stdio: 'pipe' });
}

async function gitCommit(cwd, message = 'chore: initial scaffold') {
  await execa('git', ['add', '.'], { cwd, stdio: 'pipe' });
  try {
    await execa('git', ['commit', '-m', message], { cwd, stdio: 'pipe' });
  } catch {
    // may fail if nothing to commit
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Source handlers
// ──────────────────────────────────────────────────────────────────────────────

async function* handleCommandSource(source, vars, outputDir) {
  const commands = source.commands ?? [];
  for (const step of commands) {
    const cmd = interpolate(step.cmd, vars);
    const label = step.label ? interpolate(step.label, vars) : cmd;
    yield { status: 'running', message: label };
    const code = await runCommand(cmd, outputDir);
    if (code !== 0) {
      yield { status: 'error', message: `Command failed (exit ${code}): ${cmd}` };
      return;
    }
    yield { status: 'ok', message: label };
  }
}

async function* handleLocalSource(source, vars, outputDir, configDir) {
  const srcPath = source.path
    ? path.resolve(configDir, interpolate(source.path, vars))
    : configDir;

  yield { status: 'running', message: `Copying from ${srcPath}` };
  try {
    copyDir(srcPath, outputDir, vars);
    yield { status: 'ok', message: 'Files copied' };
  } catch (err) {
    yield { status: 'error', message: `Copy failed: ${err.message}` };
  }
}

async function* handleGithubSource(source, vars, outputDir) {
  const repo = interpolate(source.repo ?? '', vars);
  const ref = interpolate(source.ref ?? 'HEAD', vars);
  const cmd = `git clone --depth=1 --branch ${ref} https://github.com/${repo}.git .`;
  yield { status: 'running', message: `Cloning ${repo}@${ref}` };
  const code = await runCommand(cmd, outputDir);
  if (code !== 0) {
    yield { status: 'error', message: `git clone failed for ${repo}` };
    return;
  }
  yield { status: 'ok', message: `Cloned ${repo}` };
}

// ──────────────────────────────────────────────────────────────────────────────
// File utilities
// ──────────────────────────────────────────────────────────────────────────────

function copyDir(src, dest, vars) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destName = interpolate(entry.name, vars ?? {});
    const destPath = path.join(dest, destName);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, vars);
    } else {
      let content = fs.readFileSync(srcPath, 'utf8');
      content = interpolate(content, vars ?? {});
      fs.writeFileSync(destPath, content, 'utf8');
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Main scaffold function  (async generator → status events)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ status: 'running'|'ok'|'error'|'info', message: string }} ScaffoldEvent
 */

/**
 * Scaffold a project from a loaded config object.
 *
 * @param {object}             options
 * @param {object}             options.config       - parsed config.json
 * @param {string}             options.configDir    - directory where config lives
 * @param {Record<string,string>} options.variables - template variables
 * @param {string}             options.outputDir    - destination directory
 * @returns {AsyncGenerator<ScaffoldEvent>}
 */
export async function* scaffold({ config, configDir, variables, outputDir }) {
  const vars = variables ?? {};
  const source = config.source ?? {};

  // ── 1. Source ──────────────────────────────────────────────────────────────
  switch (source.type) {
    case 'command':
      yield* handleCommandSource(source, vars, outputDir);
      break;
    case 'local':
      yield* handleLocalSource(source, vars, outputDir, configDir);
      break;
    case 'github':
      yield* handleGithubSource(source, vars, outputDir);
      break;
    default:
      yield { status: 'info', message: `Source type "${source.type}" — skipping (not yet supported in JS CLI)` };
  }

  // ── 2. post_init commands ──────────────────────────────────────────────────
  for (const step of config.post_init ?? []) {
    const cmd = interpolate(step.cmd, vars);
    const label = step.label ? interpolate(step.label, vars) : cmd;
    yield { status: 'running', message: label };
    const code = await runCommand(cmd, outputDir);
    if (code !== 0) {
      yield { status: 'error', message: `post_init failed (exit ${code}): ${cmd}` };
    } else {
      yield { status: 'ok', message: label };
    }
  }

  // ── 3. git init + commit ───────────────────────────────────────────────────
  try {
    yield { status: 'running', message: 'git init' };
    await gitInit(outputDir);
    await gitCommit(outputDir);
    yield { status: 'ok', message: 'Git repository initialised' };
  } catch (err) {
    yield { status: 'warning', message: `git init skipped: ${err.message}` };
  }

  yield { status: 'info', message: `Done! Project created in ${outputDir}` };
}
