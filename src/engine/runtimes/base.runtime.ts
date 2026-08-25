/**
 * base-runtime.ts
 *
 * Base runtime engine for scaffolders.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import type { ScaffoldEvent, ScaffoldOptions } from '../../types/index.js';
import type { ConfigSource } from '../../types/index.js';
import process from 'node:process';

export abstract class BaseRuntimeEngine {
  abstract name: string;

  /**
   * Abstract method implemented by runtime-specific engines (e.g. DotNetRuntimeEngine).
   */
  abstract handleStructureSource(
    source: ConfigSource,
    vars: Record<string, string>,
    outputDir: string,
    projectName: string
  ): AsyncGenerator<ScaffoldEvent>;

  /**
   * Run a shell command in the given working directory.
   */
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

  // ──────────────────────────────────────────────────────────────────────────────
  // Template interpolation  {{variable}}
  // ──────────────────────────────────────────────────────────────────────────────

  protected interpolate(str: string, vars: Record<string, string>): string {
    return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? _);
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // Git helpers
  // ──────────────────────────────────────────────────────────────────────────────

  protected async gitInit(cwd: string): Promise<void> {
    await execa('git', ['init'], { cwd, stdio: 'pipe' });
  }

  protected async gitCommit(cwd: string, message = 'chore: initial scaffold'): Promise<void> {
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

  protected async *handleCommandSource(
    source: ConfigSource,
    vars: Record<string, string>,
    outputDir: string
  ): AsyncGenerator<ScaffoldEvent> {
    const commands = source.commands ?? [];
    for (const step of commands) {
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

  // ──────────────────────────────────────────────────────────────────────────────
  // File utilities
  // ──────────────────────────────────────────────────────────────────────────────

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