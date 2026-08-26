/**
 * config-loader.ts
 *
 * Loads kiln config.json / config.jsonc files from the built-in configs
 * directory and from extra user-supplied directories.
 *
 * Validation produces typed diagnostics:
 *   { level: 'error' | 'warning', path: string, message: string }
 *
 * Errors   → config cannot be used (required fields missing / wrong type)
 * Warnings → config will work but something looks suspicious
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AjvModule = require('ajv');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const addFormatsModule = require('ajv-formats');
// AJV v8 ships as CJS; the default export under require() is the class itself.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AjvClass = (AjvModule as any).default ?? AjvModule;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const addFormats = (addFormatsModule as any).default ?? addFormatsModule;
import { configSchema } from './schema.js';
import type { Diagnostic, LoadConfigResult } from '../../types/index.js';
import type { TreeNode } from '../../types/index.js';
import type { KilnConfig } from '../../types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_CONFIGS = path.resolve(__dirname, '../../configs');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ajv = new AjvClass({ allErrors: true, strict: false }) as any;
addFormats(ajv);
const _validate = ajv.compile(configSchema);

// ──────────────────────────────────────────────────────────────────────────────
// Validation
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Validate a parsed config object and return typed diagnostics.
 */
export function validateConfig(config: KilnConfig): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const valid = _validate(config);
  if (!valid && _validate.errors) {
    for (const err of _validate.errors) {
      const loc = err.instancePath || '/';
      const isTypeError =
        err.keyword === 'type' ||
        err.keyword === 'required' ||
        err.keyword === 'minLength' ||
        err.keyword === 'enum';

      diagnostics.push({
        level: isTypeError ? 'error' : 'warning',
        path: loc,
        message: ajv.errorsText([err], { separator: '; ', dataVar: 'config' }),
      });
    }
  }

  if (!config.source && !config.structure) {
    diagnostics.push({
      level: 'error',
      path: '/',
      message: 'Config must have at least one of "source" or "structure" defined',
    });
  }

  // Extra semantic warnings beyond JSON Schema
  if (config.source?.type === 'command' && !config.source.commands?.length) {
    diagnostics.push({
      level: 'warning',
      path: '/source/commands',
      message: 'source.type is "command" but no commands are defined',
    });
  }

  if (config.variables) {
    const keys = new Set<string>();
    for (const v of config.variables) {
      if (keys.has(v.key)) {
        diagnostics.push({
          level: 'warning',
          path: '/variables',
          message: `Duplicate variable key "${v.key}"`,
        });
      }
      keys.add(v.key);
    }
  }

  return diagnostics;
}

// ──────────────────────────────────────────────────────────────────────────────
// File loading
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Load config file (json/jsonc), parse it, validate it.
 * Returns { config, diagnostics }.
 */
export function loadConfigFile(filePath: string): LoadConfigResult {
  const raw = fs.readFileSync(filePath, 'utf8');
  const errors: ParseError[] = [];
  const config = parseJsonc(raw, errors, { allowTrailingComma: true }) as KilnConfig;

  const diagnostics: Diagnostic[] = [];

  if (errors.length) {
    for (const e of errors) {
      diagnostics.push({
        level: 'error',
        path: filePath,
        message: `JSONC parse error at offset ${e.offset}: code ${e.error}`,
      });
    }
    return { config: null, diagnostics };
  }

  diagnostics.push(...validateConfig(config));
  return { config, diagnostics };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tree helpers
// ──────────────────────────────────────────────────────────────────────────────

function formatName(folderName: string): string {
  return folderName.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function findManifest(dir: string): string | null {
  const jsonc = path.join(dir, 'config.jsonc');
  if (fs.existsSync(jsonc)) return jsonc;
  const json = path.join(dir, 'config.json');
  if (fs.existsSync(json)) return json;
  return null;
}

function getDisplayName(manifestPath: string, fallback: string): string {
  try {
    const { config } = loadConfigFile(manifestPath);
    return config?.name || fallback;
  } catch {
    return fallback;
  }
}

function isConfigFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.startsWith('config') && (lower.endsWith('.json') || lower.endsWith('.jsonc'));
}

function scanDir(dir: string): TreeNode[] {
  const nodes: TreeNode[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    );
  } catch {
    return nodes;
  }

  const configFiles = entries.filter((e) => e.isFile() && isConfigFile(e.name));
  const subdirs = entries.filter(
    (e) =>
      e.isDirectory() &&
      !e.name.startsWith('.') &&
      e.name !== '__pycache__' &&
      e.name !== 'node_modules'
  );

  // Standard single-manifest leaf
  const standard = configFiles.find((f) => f.name === 'config.json' || f.name === 'config.jsonc');
  if (standard && configFiles.length === 1) {
    const manifestPath = path.join(dir, standard.name);
    const name = getDisplayName(manifestPath, formatName(path.basename(dir)));
    nodes.push({ name, filePath: dir, isLeaf: true, configPath: manifestPath });
    return nodes;
  }

  // Multiple variants or non-standard name — nav node
  if (configFiles.length) {
    const children: TreeNode[] = [];
    for (const cf of configFiles) {
      const manifestPath = path.join(dir, cf.name);
      const fallback =
        configFiles.length > 1
          ? formatName(path.parse(cf.name).name)
          : formatName(path.basename(dir));
      const name = configFiles.length > 1 ? fallback : getDisplayName(manifestPath, fallback);
      children.push({ name, filePath: dir, isLeaf: true, configPath: manifestPath });
    }
    for (const sub of subdirs) {
      children.push(...scanDir(path.join(dir, sub.name)));
    }
    if (children.length) {
      nodes.push({ name: formatName(path.basename(dir)), filePath: dir, isLeaf: false, children });
    }
    return nodes;
  }

  // No manifest — pure navigation node
  const children: TreeNode[] = [];
  for (const sub of subdirs) {
    children.push(...scanDir(path.join(dir, sub.name)));
  }
  if (children.length) {
    nodes.push({ name: formatName(path.basename(dir)), filePath: dir, isLeaf: false, children });
  }
  return nodes;
}

/**
 * Build the merged config tree from built-in + extra dirs.
 */
export function buildConfigTree(extraDirs: string[] = []): TreeNode {
  const roots = [BUILTIN_CONFIGS, ...extraDirs];
  const root: TreeNode = { name: 'root', filePath: '/', isLeaf: false, children: [] };

  for (const rootDir of roots) {
    if (!fs.existsSync(rootDir)) continue;
    let topLevel: fs.Dirent[];
    try {
      topLevel = fs.readdirSync(rootDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of topLevel.sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    )) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      root.children!.push(...scanDir(path.join(rootDir, entry.name)));
    }
  }

  return root;
}

/**
 * Walk the tree to find a leaf by slash-separated id, e.g. "react/vite".
 */
export function findNodeById(root: TreeNode, id: string): TreeNode | null {
  const parts = id.replace(/^\/|\/$/g, '').split('/').filter(Boolean);
  let node: TreeNode = root;
  for (const part of parts) {
    const match = (node.children ?? []).find((c) => {
      const slug = path.basename(c.filePath);
      return (
        slug === part ||
        slug.toLowerCase().replace(/[-_]/g, ' ') === part.toLowerCase().replace(/[-_]/g, ' ')
      );
    });
    if (!match) return null;
    node = match;
  }
  return node?.isLeaf ? node : null;
}