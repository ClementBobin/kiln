/**
 * template-loader.ts
 *
 * Resolves template names to their on-disk directory, scans all files
 * recursively, and applies them to a destination directory with
 * {{ variable }} interpolation.
 *
 * Template resolution order:
 *   1. <repo-root>/templates/<name>/     (built-in templates shipped with kiln)
 *   2. <configDir>/templates/<name>/     (config-local templates, future use)
 *
 * A template is just a directory of files. Every file's content and name
 * are interpolated before being written to the destination.
 *
 * Usage
 * ─────
 *   const tpl = resolveTemplate('react_structure', templateRoots);
 *   if (!tpl) throw new Error('Template not found');
 *   applyTemplate({ template: tpl, destDir: '/path/to/project/src', vars });
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ResolvedTemplate, TemplateFile, ApplyTemplateOptions } from '../../types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the built-in templates/ directory at the repo root */
export const BUILTIN_TEMPLATES_DIR = path.resolve(__dirname, '../../templates');

// ──────────────────────────────────────────────────────────────────────────────
// Resolution
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Scan a directory recursively and return all file paths.
 */
function scanFiles(dir: string, base: string = dir): TemplateFile[] {
  const results: TemplateFile[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanFiles(abs, base));
    } else if (entry.isFile()) {
      results.push({
        relativePath: path.relative(base, abs),
        absolutePath: abs,
      });
    }
  }
  return results;
}

/**
 * Resolve a template name to a `ResolvedTemplate` by searching each
 * directory in `roots` in order.  Returns `null` if not found.
 */
export function resolveTemplate(
  name: string,
  roots: string[] = [BUILTIN_TEMPLATES_DIR],
): ResolvedTemplate | null {
  for (const root of roots) {
    const dir = path.join(root, name);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      return { name, dir, files: scanFiles(dir) };
    }
  }
  return null;
}

/**
 * Resolve multiple template names.  Emits warnings (returned as strings)
 * for any name that cannot be found.
 */
export function resolveTemplates(
  names: string[],
  roots: string[] = [BUILTIN_TEMPLATES_DIR],
): { resolved: ResolvedTemplate[]; missing: string[] } {
  const resolved: ResolvedTemplate[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const tpl = resolveTemplate(name, roots);
    if (tpl) {
      resolved.push(tpl);
    } else {
      missing.push(name);
    }
  }
  return { resolved, missing };
}

// ──────────────────────────────────────────────────────────────────────────────
// Application
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Interpolate `{{ key }}` placeholders in a string.
 * Unknown keys are left as-is so they surface as visible placeholders.
 */
function interpolate(str: string, vars: Record<string, string>): string {
  return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => vars[key] ?? match);
}

/**
 * Decide whether a file should be treated as text (interpolated) or binary
 * (copied verbatim).  We use a simple extension allowlist.
 */
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.kt', '.kts',
  '.cs', '.fs',
  '.json', '.jsonc', '.yaml', '.yml', '.toml',
  '.md', '.mdx', '.txt',
  '.html', '.htm', '.css', '.scss', '.less',
  '.sh', '.bash', '.zsh',
  '.xml', '.svg',
  '.env', '.env.example', '.env.local',
  '.gitignore', '.gitkeep', '.editorconfig', '.prettierrc',
]);

function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath);
  // Files with no extension but known names (e.g. .gitignore)
  if (!ext && (base.startsWith('.') || base === 'Makefile' || base === 'Dockerfile')) return true;
  return TEXT_EXTENSIONS.has(ext);
}

/**
 * Write all files from `template` into `destDir`, interpolating both
 * file content and the relative path (so `{{ project_name }}.ts` becomes
 * `my-app.ts`).
 *
 * Existing files are silently overwritten — templates are additive, not
 * protective of user edits.
 */
export function applyTemplate({ template, destDir, vars }: ApplyTemplateOptions): void {
  fs.mkdirSync(destDir, { recursive: true });

  for (const file of template.files) {
    // Interpolate the path segments so template dirs can use variable names
    const destRelative = interpolate(file.relativePath, vars);
    const destPath = path.join(destDir, destRelative);

    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    if (isTextFile(file.absolutePath)) {
      const raw = fs.readFileSync(file.absolutePath, 'utf8');
      fs.writeFileSync(destPath, interpolate(raw, vars), 'utf8');
    } else {
      fs.copyFileSync(file.absolutePath, destPath);
    }
  }
}