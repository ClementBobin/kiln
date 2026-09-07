/**
 * node.runtime.ts
 *
 * Runtime engine for Node.js / JavaScript / TypeScript projects.
 *
 * Structure shape (config.structure)
 * ────────────────────────────────────
 * The `structure` field for Node projects is a mixed object:
 *
 *   "structure": {
 *     "templates": ["react_structure"],   ← root-level templates → copied to project root
 *     "app": {                            ← directory created at project root
 *       "folders": ["api"]               ← sub-directory: app/api/
 *     },
 *     "components": {
 *       "templates": ["my_components"]    ← template copied into components/
 *     }
 *   }
 *
 * Layer keys are real directory names relative to the project root — NOT
 * nested inside a hardcoded "src/" prefix. This matches how Next.js, Vite,
 * and other CLI generators lay out their projects (app/, src/, components/…).
 *
 * After a command source runs (e.g. `npx create-next-app@latest`), the
 * structure block is used to:
 *   1. Apply root-level templates into the newly created project directory.
 *   2. Create any declared directories and sub-directories.
 *   3. Apply per-layer / per-folder templates.
 */

import fs from 'node:fs';
import path from 'node:path';
import { BaseRuntimeEngine } from './base.runtime.js';
import type { ScaffoldEvent, KilnConfig, CommandStep } from '../../../types/index.js';
import type { FolderConfig } from '../../../types/index.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve the project root inside outputDir after a command like
 * `npx create-next-app@latest {{project_name}}` which creates a sub-directory.
 * Falls back to outputDir itself if no matching sub-directory exists.
 */
function resolveProjectRoot(outputDir: string, projectName?: string): string {
  if (projectName) {
    const candidate = path.join(outputDir, projectName);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return outputDir;
}

// ── Runtime ───────────────────────────────────────────────────────────────────

export class NodeRuntimeEngine extends BaseRuntimeEngine {
  name = 'node';

  // ── Default lifecycle steps ──────────────────────────────────────────────

  protected get defaultCheckDependencies(): CommandStep[] {
    return [
      { cmd: 'node --version', label: 'Check Node.js' },
      { cmd: 'npm --version',  label: 'Check npm' },
    ];
  }

  protected get defaultPostInit(): CommandStep[] {
    return [
      { cmd: 'npm install', label: 'Installing dependencies' },
    ];
  }

  // ── Top-level scaffold override ──────────────────────────────────────────
  //
  // When a config has BOTH source AND structure, the base scaffold() runs
  // the source commands first (which create the project directory), then we
  // apply the structure block on top of the generated project root.

  async *scaffold(
    opts: Parameters<BaseRuntimeEngine['scaffold']>[0],
  ): AsyncGenerator<ScaffoldEvent> {
    const { config, variables: vars, outputDir } = opts;

    // Full base lifecycle: checks → pre → source → post → git
    yield* super.scaffold(opts);

    // After source ran, apply structure (templates + directories) into the
    // actual project root, which may be outputDir/<project_name>/
    if (config.source && config.structure) {
      const projectRoot = resolveProjectRoot(outputDir, vars['project_name']);
      yield* this.applyStructureBlock(config, vars, projectRoot);
    }
  }

  // ── Structure handler (structure-only configs) ────────────────────────────

  protected async *handleStructure(
    config: KilnConfig,
    vars: Record<string, string>,
    outputDir: string,
  ): AsyncGenerator<ScaffoldEvent> {
    const projectName = vars['project_name'] ?? path.basename(outputDir);
    yield { status: 'running', message: `Creating Node.js project structure for ${projectName}` };

    fs.mkdirSync(outputDir, { recursive: true });

    // Create default src/ and test/ directories for pure-structure configs
    for (const d of ['src', 'test']) {
      const dir = path.join(outputDir, d);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, '.gitkeep'), '');
    }

    fs.writeFileSync(
      path.join(outputDir, '.gitignore'),
      'node_modules/\ndist/\n.env\n.DS_Store\ncoverage/\n',
    );

    yield { status: 'ok', message: 'Node.js base directories created' };

    yield* this.applyStructureBlock(config, vars, outputDir);
  }

  // ── Shared structure-block processor ─────────────────────────────────────

  /**
   * Processes a config's structure block:
   *   1. Root-level templates (structure.templates) → written into destDir
   *   2. Per-layer directories (keys other than "templates") → created inside destDir
   *      • sub-folders listed in .folders[] → created inside the layer dir
   *      • .templates[] on a layer → applied into the layer dir
   *      • per-folder .templates inside object entries → applied into that sub-dir
   *
   * Layer keys map directly to directories inside destDir — there is NO implicit
   * "src/" prefix. "app" → destDir/app/, "components" → destDir/components/, etc.
   */
  private async *applyStructureBlock(
    config: KilnConfig,
    vars: Record<string, string>,
    destDir: string,
  ): AsyncGenerator<ScaffoldEvent> {
    const structure = config.structure as Record<string, unknown> | undefined;
    if (!structure || typeof structure !== 'object' || Array.isArray(structure)) return;

    // 1. Root-level templates ─────────────────────────────────────────────
    const rootTemplates = (structure['templates'] as string[] | undefined) ?? [];
    if (rootTemplates.length) {
      yield { status: 'info', message: 'Applying root-level templates…' };
      yield* this.applyTemplates(rootTemplates, destDir, vars);
    }

    // 2. Per-layer directory entries ───────────────────────────────────────
    for (const [layerName, details] of Object.entries(structure)) {
      if (layerName === 'templates') continue; // handled above

      // Skip non-object values (bare strings, numbers, booleans used as metadata)
      if (!details || typeof details !== 'object' || Array.isArray(details)) continue;

      const layerDetails = details as {
        folders?: (string | Record<string, FolderConfig>)[];
        templates?: string[];
      };

      // Directories are created relative to destDir (the project root), not src/
      const layerDir = path.join(destDir, layerName);
      fs.mkdirSync(layerDir, { recursive: true });

      // 2a. Sub-folders
      const folderEntries = layerDetails.folders ?? [];
      for (const entry of folderEntries) {
        if (typeof entry === 'string') {
          // Plain string → create the sub-directory
          const subDir = path.join(layerDir, entry);
          fs.mkdirSync(subDir, { recursive: true });
          fs.writeFileSync(path.join(subDir, '.gitkeep'), '');
        } else {
          // Object entry → { folderName: { templates?: [...] } }
          for (const [folderName, folderCfg] of Object.entries(entry)) {
            const subDir = path.join(layerDir, folderName);
            fs.mkdirSync(subDir, { recursive: true });

            const folderTemplates = (folderCfg as FolderConfig).templates ?? [];
            if (folderTemplates.length) {
              yield* this.applyTemplates(folderTemplates, subDir, vars);
            } else {
              fs.writeFileSync(path.join(subDir, '.gitkeep'), '');
            }
          }
        }
      }

      // 2b. Layer-level templates (written into the layer dir itself)
      const layerTemplates = layerDetails.templates ?? [];
      if (layerTemplates.length) {
        yield* this.applyTemplates(layerTemplates, layerDir, vars);
      } else if (!folderEntries.length) {
        // No sub-folders, no templates → at least keep the dir tracked
        fs.writeFileSync(path.join(layerDir, '.gitkeep'), '');
      }

      yield { status: 'ok', message: `Directory ready: ${layerName}/` };
    }
  }
}