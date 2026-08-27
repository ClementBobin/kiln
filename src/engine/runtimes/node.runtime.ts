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
 *     "src": {                            ← custom source layer
 *       "folders": ["api", "pages"],
 *       "templates": ["my_src_tpl"]       ← layer templates → copied into src/
 *     },
 *     "app": {
 *       "folders": ["api"]
 *     }
 *   }
 *
 * After a command source runs (e.g. `npm create vite@latest`), the structure
 * block is used to:
 *   1. Apply root-level templates into the newly created project directory.
 *   2. Create any declared custom layers / folders.
 *   3. Apply per-layer templates into that layer's directory.
 */

import fs from 'node:fs';
import path from 'node:path';
import { BaseRuntimeEngine } from './base.runtime.js';
import type { ScaffoldEvent, KilnConfig, CommandStep } from '../../../types/index.js';
import type { FolderConfig } from '../../../types/index.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve the project root inside outputDir after a command like
 * `npm create vite@latest {{project_name}}` which creates a sub-directory.
 * Falls back to outputDir if the sub-directory doesn't exist.
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

  // ── Source handler override ──────────────────────────────────────────────
  //
  // After command-source scaffolding completes, we still process the
  // structure block (if present) to apply templates and extra folders.

  protected async *handleCommandSource(
    source: Parameters<BaseRuntimeEngine['handleCommandSource']>[0],
    vars: Record<string, string>,
    outputDir: string,
  ): AsyncGenerator<ScaffoldEvent> {
    // Run the commands (e.g. npm create vite@latest)
    yield* super.handleCommandSource(source, vars, outputDir);

    // Now apply structure on top of the generated project
    const config = { structure: undefined } as unknown as KilnConfig;
    // We need the real config — handled in scaffold() via handleStructureBlock
    // This is called from scaffold() which has the full config. We delegate to
    // a separate method that callers of scaffold() trigger explicitly by
    // overriding the top-level scaffold() in this class.
  }

  // Override top-level scaffold() to run structureBlock after source
  async *scaffold(
    opts: Parameters<BaseRuntimeEngine['scaffold']>[0],
  ): AsyncGenerator<ScaffoldEvent> {
    const { config, variables: vars, outputDir } = opts;

    // Run the full base lifecycle (checks → pre → source → post → git)
    yield* super.scaffold(opts);

    // After source ran, apply the structure block (templates + extra folders)
    // into the actual project root (which may be outputDir/<project_name>/)
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

    // Default directories for pure-structure configs (no source command)
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
   *   1. Root-level templates (structure.templates) → destDir
   *   2. Per-layer directories + per-layer templates
   *
   * Works the same whether triggered from a source+structure config or a
   * structure-only config.
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

    // 2. Per-layer entries ─────────────────────────────────────────────────
    for (const [layerName, details] of Object.entries(structure)) {
      if (layerName === 'templates') continue; // already handled above

      const layerDetails = details as {
        folders?: (string | Record<string, FolderConfig>)[];
        templates?: string[];
      } | null | undefined;

      if (!layerDetails || typeof layerDetails !== 'object') continue;

      const layerDir = path.join(destDir, 'src', layerName.toLowerCase());
      fs.mkdirSync(layerDir, { recursive: true });

      // 2a. Sub-folders with optional per-folder templates
      const folderEntries = layerDetails.folders ?? [];
      for (const entry of folderEntries) {
        if (typeof entry === 'string') {
          // Plain string → just create the directory
          const subDir = path.join(layerDir, entry);
          fs.mkdirSync(subDir, { recursive: true });
          fs.writeFileSync(path.join(subDir, '.gitkeep'), '');
        } else {
          // Object → { folderName: { templates?: [...] } }
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

      // 2b. Layer-level templates (copied into the layer directory)
      const layerTemplates = layerDetails.templates ?? [];
      if (layerTemplates.length) {
        yield* this.applyTemplates(layerTemplates, layerDir, vars);
      } else if (!folderEntries.length) {
        // Empty layer — drop a .gitkeep so git tracks the dir
        fs.writeFileSync(path.join(layerDir, '.gitkeep'), '');
      }

      yield { status: 'ok', message: `Layer ready: src/${layerName.toLowerCase()}/` };
    }
  }
}