/**
 * plugin-loader.ts
 *
 * Scans the plugin/ directory (and any extra plugin dirs) for plugin.json
 * manifests, validates them, and builds a PluginTreeNode hierarchy for the
 * interactive picker.
 *
 * Layout on disk:
 *
 *   plugin/
 *     dotnet/
 *       jwt/
 *         plugin.json        ← leaf
 *         AuthExtensions.cs
 *         …
 *       efcore/
 *         plugin.json        ← leaf (top-level efcore plugin)
 *         interceptor/
 *           plugin.json      ← nested leaf
 *           …
 *     nodejs/
 *       prisma/
 *         plugin.json
 *         …
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import type {
  PluginManifest,
  ResolvedPlugin,
  PluginTreeNode,
} from '../../types/index.js';
import type { Diagnostic } from '../../types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BUILTIN_PLUGINS_DIR = path.resolve(__dirname, '../../plugin');

// ──────────────────────────────────────────────────────────────────────────────
// Manifest loading + validation
// ──────────────────────────────────────────────────────────────────────────────

export interface LoadedPlugin {
  plugin: ResolvedPlugin | null;
  diagnostics: Diagnostic[];
}

export function loadPluginManifest(manifestPath: string, pluginRoot: string): LoadedPlugin {
  const diagnostics: Diagnostic[] = [];

  let raw: string;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
  } catch {
    diagnostics.push({ level: 'error', path: manifestPath, message: 'Cannot read plugin.json' });
    return { plugin: null, diagnostics };
  }

  const parseErrors: ParseError[] = [];
  const manifest = parseJsonc(raw, parseErrors, { allowTrailingComma: true }) as PluginManifest;

  if (parseErrors.length) {
    for (const e of parseErrors) {
      diagnostics.push({
        level: 'error',
        path: manifestPath,
        message: `JSONC parse error at offset ${e.offset}: code ${e.error}`,
      });
    }
    return { plugin: null, diagnostics };
  }

  // Basic structural validation
  if (!manifest?.name || typeof manifest.name !== 'string') {
    diagnostics.push({ level: 'error', path: manifestPath, message: 'plugin.json must have a "name" string' });
  }
  if (!manifest?.apply || typeof manifest.apply !== 'object') {
    diagnostics.push({ level: 'error', path: manifestPath, message: 'plugin.json must have an "apply" object' });
  }
  if (manifest?.apply?.type === 'script' && !manifest.apply.file) {
    diagnostics.push({ level: 'warning', path: manifestPath, message: 'apply.type is "script" but no apply.file specified' });
  }

  if (diagnostics.some((d) => d.level === 'error')) {
    return { plugin: null, diagnostics };
  }

  const pluginDir = path.dirname(manifestPath);
  // Build an id relative to the plugin root
  const rel = path.relative(pluginRoot, pluginDir);
  const id  = rel.split(path.sep).join('/');

  const plugin: ResolvedPlugin = {
    name: manifest.name,
    dir: pluginDir,
    manifestPath,
    manifest,
    id,
  };

  return { plugin, diagnostics };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tree building
// ──────────────────────────────────────────────────────────────────────────────

function formatName(name: string): string {
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function scanPluginDir(dir: string, pluginRoot: string): PluginTreeNode[] {
  const nodes: PluginTreeNode[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  } catch {
    return nodes;
  }

  const hasManifest = entries.some((e) => e.isFile() && e.name === 'plugin.json');
  const subdirs     = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'));

  if (hasManifest) {
    // This directory is a leaf — it has its own plugin.json.
    // It may ALSO have subdirectories that are nested plugins.
    const manifestPath = path.join(dir, 'plugin.json');
    const { plugin } = loadPluginManifest(manifestPath, pluginRoot);

    const leafNode: PluginTreeNode = {
      name: plugin?.name ?? formatName(path.basename(dir)),
      dirPath: dir,
      isLeaf: true,
      plugin: plugin ?? undefined,
    };

    // Nested plugins: if subdirs also have plugin.json, expose them as children
    const nestedChildren: PluginTreeNode[] = [];
    for (const sub of subdirs) {
      nestedChildren.push(...scanPluginDir(path.join(dir, sub.name), pluginRoot));
    }

    if (nestedChildren.length) {
      // Turn this into a nav node with both the leaf plugin and nested ones
      return [
        leafNode,
        {
          name: formatName(path.basename(dir)),
          dirPath: dir,
          isLeaf: false,
          children: nestedChildren,
        },
      ];
    }

    return [leafNode];
  }

  // No manifest here — nav-only node
  if (subdirs.length) {
    const children: PluginTreeNode[] = [];
    for (const sub of subdirs) {
      children.push(...scanPluginDir(path.join(dir, sub.name), pluginRoot));
    }
    if (children.length) {
      nodes.push({
        name: formatName(path.basename(dir)),
        dirPath: dir,
        isLeaf: false,
        children,
      });
    }
  }

  return nodes;
}

export function buildPluginTree(extraDirs: string[] = []): PluginTreeNode {
  const roots = [BUILTIN_PLUGINS_DIR, ...extraDirs];
  const root: PluginTreeNode = {
    name: 'root',
    dirPath: '/',
    isLeaf: false,
    children: [],
  };

  for (const rootDir of roots) {
    if (!fs.existsSync(rootDir)) continue;
    let topLevel: fs.Dirent[];
    try {
      topLevel = fs.readdirSync(rootDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of topLevel.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      root.children!.push(...scanPluginDir(path.join(rootDir, entry.name), rootDir));
    }
  }

  return root;
}