/**
 * base.runtime.ts
 *
 * Abstract base class shared by all runtime engines.
 *
 * Lifecycle execution order
 * ─────────────────────────
 *   1. check_dependencies  — verify required tools exist (exit 0 = present)
 *   2. pre_init            — environment / directory setup
 *   3. source / structure  — actual scaffolding
 *      └─ applyTemplates() is called by subclasses wherever templates fit
 *   4. post_init           — restore / install / format
 *   5. git init + commit
 *
 * Default step merging for pre_init / check_dependencies / post_init
 * ───────────────────────────────────────────────────────────────────
 * Each runtime defines its own default steps (protected getters that subclasses
 * may override).  The config author can then:
 *
 *   • Omit the field (or use `[]`)   → runtime defaults run as-is.
 *   • Set the field to `null`         → skip everything (no defaults, no user steps).
 *   • Provide steps without override  → user steps are APPENDED after the defaults.
 *   • Provide steps with override:true → those steps REPLACE the defaults entirely;
 *                                        remaining non-override steps still append.
 *
 * The helper `mergeSteps(defaults, configured)` implements this logic.
 *
 * Template application
 * ────────────────────
 * `applyTemplates(names, destDir, vars, templateRoots?)` resolves each
 * template name to its directory in templates/ and copies all files into
 * `destDir` with {{ var }} interpolation.  It yields ScaffoldEvents so
 * subclasses can call it with `yield*`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import type { ScaffoldEvent, ScaffoldOptions } from '../../../types/index.js';
import type { CommandStep, ConfigSource, KilnConfig } from '../../../types/index.js';
import type { Diagnostic } from '../../../types/index.js';
import process from 'node:process';
import {
  resolveTemplates,
  applyTemplate,
  BUILTIN_TEMPLATES_DIR,
} from '../template-loader.js';

// ──────────────────────────────────────────────────────────────────────────────
// Step-merge logic
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Merge runtime default steps with user-configured steps.
 *
 * @param defaults    - steps defined by the runtime (never null here)
 * @param configured  - value from the config file (undefined | null | array)
 *   - undefined / []        → return defaults unchanged
 *   - null                  → return [] (skip everything)
 *   - array with override   → overriding steps REPLACE defaults; the rest append
 */
export function mergeSteps(
  defaults: CommandStep[],
  configured: CommandStep[] | null | undefined,
): CommandStep[] {
  // null  → explicit "skip everything"
  if (configured === null) return [];

  // absent or empty  → defaults only
  if (!configured || configured.length === 0) return defaults;

  // Split user steps into overrides and appends
  const overrides = configured.filter((s) => s.override);
  const appends   = configured.filter((s) => !s.override);

  // At least one override present → replace defaults with override steps
  const base = overrides.length > 0 ? overrides : defaults;

  return [...base, ...appends];
}

// ──────────────────────────────────────────────────────────────────────────────
// Base class
// ──────────────────────────────────────────────────────────────────────────────

export abstract class BaseRuntimeEngine {
  abstract name: string;

  // ── Default lifecycle steps (subclasses override these) ───────────────────

  /**
   * Commands that verify required tools exist.
   * Each cmd should exit 0 when the tool is present (e.g. `node --version`).
   * Return [] to perform no checks by default.
   */
  protected get defaultCheckDependencies(): CommandStep[] {
    return [];
  }

  /**
   * Commands that run before scaffolding (env setup, directory prep…).
   * Return [] for no pre-init steps by default.
   */
  protected get defaultPreInit(): CommandStep[] {
    return [];
  }

  /**
   * Commands that run after scaffolding (install, restore, format…).
   * Return [] for no post-init steps by default.
   */
  protected get defaultPostInit(): CommandStep[] {
    return [];
  }

  // ── Subclass hook ─────────────────────────────────────────────────────────

  /**
   * Scaffold from a structure block (no source).
   * Subclasses override this; base emits an info and does nothing.
   */
  protected async *handleStructure(
    _config: KilnConfig,
    _vars: Record<string, string>,
    _outputDir: string,
  ): AsyncGenerator<ScaffoldEvent> {
    yield {
      status: 'info',
      message: `Runtime "${this.name}" does not support structure-based scaffolding`,
    };
  }

  /** Optional extra config validation. Return [] if nothing to check. */
  validateConfig(_config: KilnConfig): Diagnostic[] {
    return [];
  }

  // ── Template application ──────────────────────────────────────────────────

  /**
   * Resolve and apply a list of template names into `destDir`.
   *
   * Yields `ScaffoldEvent`s so subclasses can delegate with `yield*`:
   *
   *   yield* this.applyTemplates(['react_structure'], outputDir, vars);
   *
   * @param names        - template names as written in the config
   * @param destDir      - absolute directory to write files into
   * @param vars         - interpolation variables
   * @param extraRoots   - additional template search roots (config-local)
   */
  protected async *applyTemplates(
    names: string[],
    destDir: string,
    vars: Record<string, string>,
    extraRoots: string[] = [],
  ): AsyncGenerator<ScaffoldEvent> {
    if (!names.length) return;

    const roots = [BUILTIN_TEMPLATES_DIR, ...extraRoots];
    const { resolved, missing } = resolveTemplates(names, roots);

    for (const name of missing) {
      yield { status: 'warning', message: `Template "${name}" not found — skipped` };
    }

    for (const template of resolved) {
      yield { status: 'running', message: `Applying template: ${template.name}` };
      try {
        applyTemplate({ template, destDir, vars });
        yield {
          status: 'ok',
          message: `Template applied: ${template.name} (${template.files.length} file${template.files.length === 1 ? '' : 's'})`,
        };
      } catch (err: unknown) {
        yield {
          status: 'error',
          message: `Failed to apply template "${template.name}": ${(err as Error).message}`,
        };
      }
    }
  }

  // ── Top-level scaffold generator ──────────────────────────────────────────

  async *scaffold(opts: ScaffoldOptions): AsyncGenerator<ScaffoldEvent> {
    const { config, configDir, variables: vars, outputDir } = opts;

    // ── 1. check_dependencies ───────────────────────────────────────────────
    const depSteps = mergeSteps(this.defaultCheckDependencies, config.check_dependencies);
    if (depSteps.length) {
      yield { status: 'info', message: 'Checking dependencies…' };
      for (const step of depSteps) {
        const cmd   = this.interpolate(step.cmd, vars);
        const label = step.label ? this.interpolate(step.label, vars) : cmd;
        yield { status: 'running', message: `check: ${label}` };
        const code = await this.runCommand(cmd, outputDir);
        if (code !== 0) {
          yield {
            status: 'error',
            message: `Dependency check failed — "${cmd}" exited ${code}. Is the tool installed?`,
          };
          return;
        }
        yield { status: 'ok', message: `Found: ${label}` };
      }
    }

    // ── 2. pre_init ─────────────────────────────────────────────────────────
    const preSteps = mergeSteps(this.defaultPreInit, config.pre_init);
    if (preSteps.length) {
      yield { status: 'info', message: 'Running pre-init steps…' };
      for (const step of preSteps) {
        const cmd   = this.interpolate(step.cmd, vars);
        const label = step.label ? this.interpolate(step.label, vars) : cmd;
        yield { status: 'running', message: label };
        const code = await this.runCommand(cmd, outputDir);
        if (code !== 0) {
          yield { status: 'error', message: `pre_init failed (exit ${code}): ${cmd}` };
          return;
        }
        yield { status: 'ok', message: label };
      }
    }

    // ── 3. Source / structure ────────────────────────────────────────────────
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
          yield {
            status: 'info',
            message: `Source type "${(config.source as { type: string }).type}" not yet supported`,
          };
      }
    } else if (config.structure) {
      yield* this.handleStructure(config, vars, outputDir);
    }

    // ── 4. post_init ─────────────────────────────────────────────────────────
    const postSteps = mergeSteps(this.defaultPostInit, config.post_init);
    if (postSteps.length) {
      yield { status: 'info', message: 'Running post-init steps…' };
      for (const step of postSteps) {
        const cmd   = this.interpolate(step.cmd, vars);
        const label = step.label ? this.interpolate(step.label, vars) : cmd;
        yield { status: 'running', message: label };
        const code = await this.runCommand(cmd, outputDir);
        if (code !== 0) {
          yield { status: 'error', message: `post_init failed (exit ${code}): ${cmd}` };
        } else {
          yield { status: 'ok', message: label };
        }
      }
    }

    // ── 5. git init + commit ─────────────────────────────────────────────────
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

  // ── Shell runner ──────────────────────────────────────────────────────────

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

  // ── Interpolation ─────────────────────────────────────────────────────────

  protected interpolate(str: string, vars: Record<string, string>): string {
    return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? _);
  }

  // ── Folder helpers ────────────────────────────────────────────────────────

  /**
   * Flatten a mixed folder list `(string | Record<string, unknown>)[]`
   * into plain string names.
   */
  protected flattenFolders(
    folders: (string | Record<string, unknown>)[],
  ): string[] {
    return folders.flatMap((f) =>
      typeof f === 'string' ? [f] : Object.keys(f),
    );
  }

  // ── Git ───────────────────────────────────────────────────────────────────

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

  // ── Source handlers ───────────────────────────────────────────────────────

  protected async *handleCommandSource(
    source: ConfigSource,
    vars: Record<string, string>,
    outputDir: string,
  ): AsyncGenerator<ScaffoldEvent> {
    for (const step of source.commands ?? []) {
      const cmd   = this.interpolate(step.cmd, vars);
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
    outputDir: string,
  ): AsyncGenerator<ScaffoldEvent> {
    const repo = this.interpolate(source.repo ?? '', vars);
    const ref  = this.interpolate(source.ref ?? 'HEAD', vars);
    const cmd  = `git clone --depth=1 --branch ${ref} https://github.com/${repo}.git .`;
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
    configDir: string,
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
      const srcPath  = path.join(src, entry.name);
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