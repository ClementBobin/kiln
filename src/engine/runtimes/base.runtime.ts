/**
 * base.runtime.ts
 *
 * Abstract base class shared by all runtime engines.
 * Provides: interpolation, shell runner, git helpers, source handlers,
 * post_init runner, and the top-level scaffold() generator.
 *
 * Subclasses implement handleStructure() for structure-based scaffolding.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import type { ScaffoldEvent, ScaffoldOptions } from '../../../types/index.js';
import type { ConfigSource, KilnConfig } from '../../../types/index.js';
import type { Diagnostic } from '../../../types/index.js';
import process from 'node:process';

export abstract class BaseRuntimeEngine {
  abstract name: string;

  // ── Subclass hook ────────────────────────────────────────────────────────────

  /**
   * Scaffold from a structure block (no source).
   * Subclasses override this; default emits an 'info' and does nothing.
   */
  protected async *handleStructure(
    config: KilnConfig,
    vars: Record<string, string>,
    outputDir: string
  ): AsyncGenerator<ScaffoldEvent> {
    yield { status: 'info', message: `Runtime "${this.name}" does not support structure-based scaffolding` };
  }

  /**
   * Optional extra validation. Return [] if nothing extra to check.
   */
  validateConfig(_config: KilnConfig): Diagnostic[] {
    return [];
  }

  // ── Top-level scaffold generator ─────────────────────────────────────────────

  async *scaffold(opts: ScaffoldOptions): AsyncGenerator<ScaffoldEvent> {
    const { config, configDir, variables: vars, outputDir } = opts;

    // 1. Source (command / github / local)
    if (config.source) {
      switch (config.source.type) {
        case 'command':
          yield* this.handleCommandSource(config.source, vars, outputDir);
          break;
        case 'github':
          yield* this.handleGithubSource(config.source, vars, outputDir);
          break;
        case 'local':
          yield* this.handleLocalSource(config.source, vars, outputDir, configDir);
          break;
        default:
          yield { status: 'info', message: `Source type "${(config.source as any).type}" not yet supported` };
      }
    } else if (config.structure) {
      // 2. Structure-based (runtime-specific)
      yield* this.handleStructure(config, vars, outputDir);
    }

    // 3. post_init
    for (const step of config.post_init ?? []) {
      const cmd = this.interpolate(step.cmd, vars);
      const label = step.label ? this.interpolate(step.label, vars) : cmd;
      yield { status: 'running', message: label };
      const code = await this.runCommand(cmd, outputDir);
      if (code !== 0) {
        yield { status: 'error', message: `post_init failed (exit ${code}): ${cmd}` };
      } else {
        yield { status: 'ok', message: label };
      }
    }

    // 4. git init + commit
    try {
      yield { status: 'running', message: 'Initialising git repository' };
      await this.gitInit(outputDir);
      await this.gitCommit(outputDir);
      yield { status: 'ok', message: 'Git repository initialised' };
    } catch (err: unknown) {
      yield { status: 'warning', message: `git init skipped: ${(err as Error).message}` };
    }

    yield { status: 'info', message: `Done! Project created in ${outputDir}` };
  }

  // ── Shell runner ─────────────────────────────────────────────────────────────

  protected async runCommand(cmd: string, cwd: string): Promise<number> {
    const shell: string | true = process.platform === 'win32' ? true : '/bin/sh';
    const child = execa(cmd, { cwd, shell, stdio: 'inherit' });
    try {
      await child;
      return 0;
    } catch (err: unknown) {
      return (err as { exitCode?: number }).exitCode ?? 1;
    }
  }

  // ── Interpolation ────────────────────────────────────────────────────────────

  protected interpolate(str: string, vars: Record<string, string>): string {
    return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? _);
  }

  // ── Git ──────────────────────────────────────────────────────────────────────

  protected async gitInit(cwd: string): Promise<void> {
    await execa('git', ['init'], { cwd, stdio: 'pipe' });
  }

  protected async gitCommit(cwd: string, message = 'chore: initial scaffold'): Promise<void> {
    await execa('git', ['add', '.'], { cwd, stdio: 'pipe' });
    try {
      await execa('git', ['commit', '-m', message], { cwd, stdio: 'pipe' });
    } catch {
      // nothing to commit — that's fine
    }
  }

  // ── Source handlers ───────────────────────────────────────────────────────────

  protected async *handleCommandSource(
    source: ConfigSource,
    vars: Record<string, string>,
    outputDir: string
  ): AsyncGenerator<ScaffoldEvent> {
    for (const step of source.commands ?? []) {
      const cmd = this.interpolate(step.cmd, vars);
      const label = step.label ? this.interpolate(step.label, vars) : cmd;
      yield { status: 'running', message: label };
      const code = await this.runCommand(cmd, outputDir);
      if (code !== 0) {
        yield { status: 'error', message: `Command failed (exit ${code}): ${cmd}` };
        return;
      }
      yield { status: 'ok', message: label };
    }
  }

  protected async *handleGithubSource(
    source: ConfigSource,
    vars: Record<string, string>,
    outputDir: string
  ): AsyncGenerator<ScaffoldEvent> {
    const repo = this.interpolate(source.repo ?? '', vars);
    const ref = this.interpolate(source.ref ?? 'HEAD', vars);
    const cmd = `git clone --depth=1 --branch ${ref} https://github.com/${repo}.git .`;
    yield { status: 'running', message: `Cloning ${repo}@${ref}` };
    const code = await this.runCommand(cmd, outputDir);
    if (code !== 0) {
      yield { status: 'error', message: `git clone failed for ${repo}` };
      return;
    }
    yield { status: 'ok', message: `Cloned ${repo}` };
  }

  protected async *handleLocalSource(
    source: ConfigSource,
    vars: Record<string, string>,
    outputDir: string,
    configDir: string
  ): AsyncGenerator<ScaffoldEvent> {
    const srcPath = source.path
      ? path.resolve(configDir, this.interpolate(source.path, vars))
      : configDir;
    yield { status: 'running', message: `Copying from ${srcPath}` };
    try {
      this.copyDir(srcPath, outputDir, vars);
      yield { status: 'ok', message: 'Files copied' };
    } catch (err: unknown) {
      yield { status: 'error', message: `Copy failed: ${(err as Error).message}` };
    }
  }

  protected copyDir(src: string, dest: string, vars: Record<string, string>): void {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destName = this.interpolate(entry.name, vars);
      const destPath = path.join(dest, destName);
      if (entry.isDirectory()) {
        this.copyDir(srcPath, destPath, vars);
      } else {
        let content = fs.readFileSync(srcPath, 'utf8');
        content = this.interpolate(content, vars);
        fs.writeFileSync(destPath, content, 'utf8');
      }
    }
  }
}
