/**
 * node.runtime.ts
 *
 * Runtime engine for Node.js / JavaScript / TypeScript projects.
 * Supports both structure-based scaffolding and source-based flows.
 */

import fs from 'node:fs';
import path from 'node:path';
import { BaseRuntimeEngine } from './base.runtime.js';
import type { ScaffoldEvent, KilnConfig, CommandStep } from '../../../types/index.js';

export class NodeRuntimeEngine extends BaseRuntimeEngine {
  name = 'node';

  // ── Default lifecycle steps ───────────────────────────────────────────────

  protected get defaultCheckDependencies(): CommandStep[] {
    return [
      { cmd: 'node --version', label: 'Check Node.js' },
      { cmd: 'npm --version', label: 'Check npm' },
    ];
  }

  protected get defaultPostInit(): CommandStep[] {
    return [
      { cmd: 'npm install', label: 'Installing dependencies' },
    ];
  }

  // ── Structure handler ─────────────────────────────────────────────────────

  protected async *handleStructure(
    config: KilnConfig,
    vars: Record<string, string>,
    outputDir: string,
  ): AsyncGenerator<ScaffoldEvent> {
    const structure = config.structure as Record<string, any> | undefined;
    
    const projectName = vars['project_name'] ?? path.basename(outputDir);

    yield { status: 'running', message: `Creating Node.js project structure for ${projectName}` };

    // 1. Create base directories
    fs.mkdirSync(outputDir, { recursive: true });
    
    const defaultDirs = ['src', 'test'];
    for (const d of defaultDirs) {
      fs.mkdirSync(path.join(outputDir, d), { recursive: true });
      fs.writeFileSync(path.join(outputDir, d, '.gitkeep'), '');
    }

    // 2. Process custom structure entries if provided
    if (structure && typeof structure === 'object' && !Array.isArray(structure)) {
      for (const [layerName, details] of Object.entries(structure)) {
        if (layerName === 'tsconfig' || layerName === 'package') continue; // handled separately

        const layerDir = path.join(outputDir, 'src', layerName.toLowerCase());
        fs.mkdirSync(layerDir, { recursive: true });

        if (details && typeof details === 'object' && !Array.isArray(details)) {
          const folderList: (string | Record<string, unknown>)[] = details.folders ?? [];
          const subFolders = this.flattenFolders(folderList);

          if (subFolders.length) {
            for (const sub of subFolders) {
              const subDir = path.join(layerDir, sub);
              fs.mkdirSync(subDir, { recursive: true });
              fs.writeFileSync(path.join(subDir, '.gitkeep'), '');
            }
          } else {
            fs.writeFileSync(path.join(layerDir, '.gitkeep'), '');
          }
        } else {
          fs.writeFileSync(path.join(layerDir, '.gitkeep'), '');
        }

        yield { status: 'ok', message: `Created src/${layerName.toLowerCase()}/ layer` };
      }
    }

    // 5. Generate .gitignore
    const gitignore = `node_modules/\ndist/\n.env\n.DS_Store\ncoverage/\n`;
    fs.writeFileSync(path.join(outputDir, '.gitignore'), gitignore);

    yield { status: 'ok', message: 'Node.js project skeleton created successfully' };
  }
}