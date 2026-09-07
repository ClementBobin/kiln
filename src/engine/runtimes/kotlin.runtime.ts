/**
 * kotlin.runtime.ts
 *
 * Runtime engine for Android / Kotlin projects.
 *
 * Structure shape (config.structure)
 * ────────────────────────────────────
 * The `structure` field for Kotlin/Android projects is a map of MVVM layers:
 *
 *   "structure": {
 *     "type": "android-app",   ← metadata key, skipped when creating dirs
 *     "data": {
 *       "folders": ["dto", "local", "remote", "repository"]
 *     },
 *     "di": {
 *       "templates": ["kotlin_app-module"]   ← layer template → copied into di/
 *     },
 *     "domain": {
 *       "folders": ["model", "repository", "usecase"]
 *     },
 *     "ui": {
 *       "folders": [
 *         "screens",
 *         { "core": { "templates": ["kotlin_ui_core"] } }  ← folder template
 *       ]
 *     }
 *   }
 *
 * Template files placed inside each layer / folder receive {{ variable }}
 * interpolation.  In particular, Kotlin templates use {{ package_name }}
 * to write the correct `package` declaration.
 */

import fs from 'node:fs';
import path from 'node:path';
import { BaseRuntimeEngine } from './base.runtime.js';
import type { ScaffoldEvent, KilnConfig } from '../../../types/index.js';
import type { FolderConfig } from '../../../types/index.js';

export class KotlinRuntimeEngine extends BaseRuntimeEngine {
  name = 'kotlin';

  // ── Structure handler ─────────────────────────────────────────────────────

  protected async *handleStructure(
    config: KilnConfig,
    vars: Record<string, string>,
    outputDir: string,
  ): AsyncGenerator<ScaffoldEvent> {
    const structure = config.structure as Record<string, unknown> | undefined;
    if (!structure || typeof structure !== 'object' || Array.isArray(structure)) {
      yield { status: 'error', message: 'kotlin runtime: config.structure must be a layer map' };
      return;
    }

    // ── 1. Resolve package name ──────────────────────────────────────────────
    let packageName = vars['package_name'] ?? this.detectPackageName(outputDir);
    if (!packageName) {
      packageName = 'com.example.myapp';
      yield {
        status: 'info',
        message: `Could not detect package name. Using default: ${packageName}`,
      };
    } else {
      yield { status: 'info', message: `Package name: ${packageName}` };
    }

    // Ensure the variable is available for template interpolation
    const effectiveVars = { ...vars, package_name: packageName };
    const packagePath   = packageName.replace(/\./g, '/');

    // Prefer java/ dir (matches existing projects) then kotlin/ as fallback
    const javaBase   = path.join(outputDir, 'app', 'src', 'main', 'java', packagePath);
    const kotlinBase = path.join(outputDir, 'app', 'src', 'main', 'kotlin', packagePath);
    const srcBase    = fs.existsSync(path.join(outputDir, 'app', 'src', 'main', 'java'))
      ? javaBase
      : kotlinBase;

    yield { status: 'running', message: 'Scaffolding MVVM architecture layers…' };
    fs.mkdirSync(srcBase, { recursive: true });

    // ── 2. Walk layers ───────────────────────────────────────────────────────
    for (const [layerName, details] of Object.entries(structure)) {
      // Skip metadata keys
      if (layerName === 'type' || layerName === 'templates') continue;

      const layerDir     = path.join(srcBase, layerName.toLowerCase());
      const layerDetails = details as {
        folders?: (string | Record<string, FolderConfig>)[];
        templates?: string[];
      } | null | undefined;

      if (!layerDetails || typeof layerDetails !== 'object') {
        // Bare key without any config — just create the dir
        fs.mkdirSync(layerDir, { recursive: true });
        fs.writeFileSync(path.join(layerDir, '.gitkeep'), '');
        yield { status: 'ok', message: `Layer created: ${layerName}/` };
        continue;
      }

      fs.mkdirSync(layerDir, { recursive: true });

      // 2a. Sub-folders (plain strings + objects with optional templates)
      const folderEntries = layerDetails.folders ?? [];
      for (const entry of folderEntries) {
        if (typeof entry === 'string') {
          const subDir = path.join(layerDir, entry);
          fs.mkdirSync(subDir, { recursive: true });
          fs.writeFileSync(path.join(subDir, '.gitkeep'), '');
        } else {
          // { folderName: { templates?: [...] } }
          for (const [folderName, folderCfg] of Object.entries(entry)) {
            const subDir          = path.join(layerDir, folderName);
            const folderTemplates = (folderCfg as FolderConfig).templates ?? [];
            fs.mkdirSync(subDir, { recursive: true });

            if (folderTemplates.length) {
              yield* this.applyTemplates(folderTemplates, subDir, effectiveVars);
            } else {
              fs.writeFileSync(path.join(subDir, '.gitkeep'), '');
            }
          }
        }
      }

      // 2b. Layer-level templates (copied into the layer dir)
      const layerTemplates = layerDetails.templates ?? [];
      if (layerTemplates.length) {
        yield* this.applyTemplates(layerTemplates, layerDir, effectiveVars);
      } else if (!folderEntries.length) {
        fs.writeFileSync(path.join(layerDir, '.gitkeep'), '');
      }

      yield { status: 'ok', message: `Layer ready: ${layerName}/` };
    }

    // ── 3. Root-level templates (if any) ────────────────────────────────────
    const rootTemplates = (structure['templates'] as string[] | undefined) ?? [];
    if (rootTemplates.length) {
      yield { status: 'info', message: 'Applying root-level templates…' };
      yield* this.applyTemplates(rootTemplates, outputDir, effectiveVars);
    }

    yield { status: 'ok', message: 'MVVM architecture layers scaffolded' };
  }

  // ── Package-name detection ────────────────────────────────────────────────

  private detectPackageName(outputDir: string): string | null {
    // Strategy 1: AndroidManifest.xml → package="…"
    const manifest = path.join(outputDir, 'app', 'src', 'main', 'AndroidManifest.xml');
    if (fs.existsSync(manifest)) {
      const content = fs.readFileSync(manifest, 'utf8');
      const match   = content.match(/package="([^"]+)"/);
      if (match?.[1]) return match[1];
    }

    // Strategy 2: walk java/ looking for the deepest single-branch path
    for (const srcRoot of ['java', 'kotlin']) {
      const dir = path.join(outputDir, 'app', 'src', 'main', srcRoot);
      if (!fs.existsSync(dir)) continue;

      const walk = (cur: string, parts: string[]): string | null => {
        const entries = fs.readdirSync(cur, { withFileTypes: true });
        const dirs    = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'));
        if (dirs.length === 1) return walk(path.join(cur, dirs[0].name), [...parts, dirs[0].name]);
        return parts.length >= 2 ? parts.join('.') : null;
      };

      const detected = walk(dir, []);
      if (detected) return detected;
    }

    return null;
  }
}