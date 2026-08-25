/**
 * config-loader.js
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
import { parse as parseJsonc } from 'jsonc-parser';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { configSchema } from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_CONFIGS = path.resolve(__dirname, '../../configs');

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const _validate = ajv.compile(configSchema);

// ──────────────────────────────────────────────────────────────────────────────
// Diagnostics
// ──────────────────────────────────────────────────────────────────────────────

/** @typedef {{ level: 'error'|'warning', path: string, message: string }} Diagnostic */

/**
 * Validate a parsed config object and return typed diagnostics.
 * @param {object} config - parsed JSON object
 * @returns {Diagnostic[]}
 */
export function validateConfig(config) {
  /** @type {Diagnostic[]} */
  const diagnostics = [];

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

  // Extra semantic warnings beyond JSON Schema
  if (config.source?.type === 'command' && !config.source.commands?.length) {
    diagnostics.push({
      level: 'warning',
      path: '/source/commands',
      message: 'source.type is "command" but no commands are defined',
    });
  }

  if (config.variables) {
    const keys = new Set();
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
// Tree
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} TreeNode
 * @property {string}     name
 * @property {string}     filePath   - absolute path to directory
 * @property {boolean}    isLeaf
 * @property {TreeNode[]} [children]
 * @property {string}     [configPath]  - only on leaves
 */

/**
 * Load config file (json/jsonc), parse it, validate it.
 * Returns { config, diagnostics }.
 * @param {string} filePath
 */
export function loadConfigFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const errors = [];
  const config = parseJsonc(raw, errors, { allowTrailingComma: true });

  /** @type {Diagnostic[]} */
  const diagnostics = [];

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

function formatName(folderName) {
  return folderName.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function findManifest(dir) {
  const jsonc = path.join(dir, 'config.jsonc');
  if (fs.existsSync(jsonc)) return jsonc;
  const json = path.join(dir, 'config.json');
  if (fs.existsSync(json)) return json;
  return null;
}

function getDisplayName(manifestPath, fallback) {
  try {
    const { config } = loadConfigFile(manifestPath);
    return config?.name || fallback;
  } catch {
    return fallback;
  }
}

function isConfigFile(filename) {
  const lower = filename.toLowerCase();
  return lower.startsWith('config') && (lower.endsWith('.json') || lower.endsWith('.jsonc'));
}

function scanDir(dir) {
  /** @type {TreeNode[]} */
  const nodes = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    );
  } catch {
    return nodes;
  }

  const configFiles = entries.filter((e) => e.isFile() && isConfigFile(e.name));
  const subdirs = entries.filter(
    (e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== '__pycache__' && e.name !== 'node_modules'
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
    const children = [];
    for (const cf of configFiles) {
      const manifestPath = path.join(dir, cf.name);
      const fallback = configFiles.length > 1 ? formatName(path.parse(cf.name).name) : formatName(path.basename(dir));
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
  const children = [];
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
 * @param {string[]} extraDirs
 * @returns {TreeNode}
 */
export function buildConfigTree(extraDirs = []) {
  const roots = [BUILTIN_CONFIGS, ...extraDirs];
  const root = { name: 'root', filePath: '/', isLeaf: false, children: [] };

  for (const rootDir of roots) {
    if (!fs.existsSync(rootDir)) continue;
    let topLevel;
    try {
      topLevel = fs.readdirSync(rootDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of topLevel.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      root.children.push(...scanDir(path.join(rootDir, entry.name)));
    }
  }

  return root;
}

/**
 * Walk the tree to find a leaf by slash-separated id, e.g. "react/vite".
 * @param {TreeNode} root
 * @param {string} id
 * @returns {TreeNode|null}
 */
export function findNodeById(root, id) {
  const parts = id.trim('/').split('/').filter(Boolean);
  let node = root;
  for (const part of parts) {
    const match = (node.children ?? []).find((c) => {
      const slug = path.basename(c.filePath);
      return slug === part || slug.toLowerCase().replace(/[-_]/g, ' ') === part.toLowerCase().replace(/[-_]/g, ' ');
    });
    if (!match) return null;
    node = match;
  }
  return node?.isLeaf ? node : null;
}
