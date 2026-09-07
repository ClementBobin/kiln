/**
 * types/template.ts
 *
 * Types for the kiln template system.
 *
 * Templates are named directories inside the top-level `templates/` folder.
 * A config can reference them by name in:
 *   - structure.templates          (root-level, copied into the project root)
 *   - structure.<layer>.templates  (per-layer, copied into that layer's dir)
 *   - structure.<folder>.templates (per-folder inside a layer)
 *
 * Template files support {{ variable }} interpolation, identical to the rest
 * of the scaffold pipeline.
 */

/** A single file resolved from a template directory. */
export interface TemplateFile {
  /** Path relative to the template root, e.g. "components/ui/Button.tsx" */
  relativePath: string;
  /** Absolute path on disk */
  absolutePath: string;
}

/**
 * A resolved template ready to be applied.
 * Produced by the template loader from a template name string.
 */
export interface ResolvedTemplate {
  /** The name string as written in the config, e.g. "react_structure" */
  name: string;
  /** Absolute path to the template directory, e.g. "/…/templates/react_structure" */
  dir: string;
  /** All files found recursively inside `dir` */
  files: TemplateFile[];
}

/**
 * Options for applying a single resolved template.
 */
export interface ApplyTemplateOptions {
  template: ResolvedTemplate;
  /** Absolute directory where files should be written */
  destDir: string;
  /** Variable map for {{ key }} interpolation */
  vars: Record<string, string>;
}