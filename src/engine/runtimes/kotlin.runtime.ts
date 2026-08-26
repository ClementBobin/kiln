/**
 * kotlin.runtime.ts
 *
 * Runtime engine for Android / Kotlin projects.
 *
 * Structure-based scaffolding creates the standard Android MVVM
 * directory layout (data/, di/, domain/, ui/) without needing Android Studio.
 * Source-based scaffolding (command / github) delegates to the base class.
 */

import fs from 'node:fs';
import path from 'node:path';
import { BaseRuntimeEngine } from './base.runtime.js';
import type { ScaffoldEvent, KilnConfig, CommandStep } from '../../../types/index.js';

export class KotlinRuntimeEngine extends BaseRuntimeEngine {
  name = 'kotlin';

  // ── Structure handler ─────────────────────────────────────────────────────

  protected async *handleStructure(
    config: KilnConfig,
    vars: Record<string, string>,
    outputDir: string
  ): AsyncGenerator<ScaffoldEvent> {
    const structure = config.structure as Record<string, any> | undefined;
    if (!structure || typeof structure !== 'object' || Array.isArray(structure)) {
      yield { status: 'error', message: 'kotlin runtime: config.structure must be a folder map' };
      return;
    }

    // 1. Auto-determine package name from project or fallback to variables/default
    let packageName = this.detectPackageName(outputDir);
    if (!packageName) {
      packageName = 'com.example.myapp';
      yield { status: 'info', message: `Could not detect package name automatically. Using default: ${packageName}` };
    } else {
      yield { status: 'info', message: `Detected package name: ${packageName}` };
    }

    const packagePath = packageName.replace(/\./g, '/');
    const srcBase = path.join(outputDir, 'app', 'src', 'main', 'java', packagePath);

    yield { status: 'running', message: `Scaffolding MVVM architecture layers into existing project...` };

    // Ensure the base source directory exists
    fs.mkdirSync(srcBase, { recursive: true });

    // 2. Walk the structure entries from config and create layers
    for (const [layerName, details] of Object.entries(structure)) {
      if (layerName === 'type') continue; // Skip metadata keys

      const layerDir = path.join(srcBase, layerName.toLowerCase());

      if (details && typeof details === 'object' && !Array.isArray(details)) {
        const folderList: (string | Record<string, unknown>)[] = details.folders ?? [];
        const subFolders = this.flattenFolders(folderList);

        if (subFolders.length) {
          for (const sub of subFolders) {
            const subName = typeof sub === 'string' ? sub : Object.keys(sub)[0];
            const subDir = path.join(layerDir, subName);
            fs.mkdirSync(subDir, { recursive: true });
            fs.writeFileSync(path.join(subDir, '.gitkeep'), '');
          }
        } else {
          fs.mkdirSync(layerDir, { recursive: true });
          fs.writeFileSync(path.join(layerDir, '.gitkeep'), '');
        }
      } else {
        fs.mkdirSync(layerDir, { recursive: true });
        fs.writeFileSync(path.join(layerDir, '.gitkeep'), '');
      }

      yield { status: 'ok', message: `Injected ${layerName}/ layer` };
    }

    yield { status: 'ok', message: 'MVVM architecture successfully layered into project' };
  }

  private detectPackageName(outputDir: string): string | null {
    // Strategy 1: Check AndroidManifest.xml for package="..." or namespace
    const manifestPath = path.join(outputDir, 'app', 'src', 'main', 'AndroidManifest.xml');
    if (fs.existsSync(manifestPath)) {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      // Match package="com.example.myapp"
      const match = content.match(/package="([^"]+)"/);
      if (match && match[1]) {
        return match[1];
      }
    }

    // Strategy 2: Fallback to scanning the Java/Kotlin source directory tree
    const javaDir = path.join(outputDir, 'app', 'src', 'main', 'java');
    if (fs.existsSync(javaDir)) {
      const walkDirs = (currentDir: string, currentPackage: string[] = []): string | null => {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        const subDirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));

        // If there's a single directory and no files yet, dive deeper
        if (subDirs.length === 1) {
          return walkDirs(path.join(currentDir, subDirs[0].name), [...currentPackage, subDirs[0].name]);
        }
        // If we found a folder depth (e.g., com/example/myapp), return it as package
        if (currentPackage.length >= 2) {
          return currentPackage.join('.');
        }
        return null;
      };

      const detected = walkDirs(javaDir);
      if (detected) return detected;
    }

    return null;
  }
}