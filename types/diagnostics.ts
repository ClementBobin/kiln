/**
 * types/diagnostics.ts
 *
 * Types for validation diagnostics emitted during config loading.
 */

export type DiagnosticLevel = 'error' | 'warning';

export interface Diagnostic {
  level: DiagnosticLevel;
  /** File path or JSON pointer where the issue was found */
  path: string;
  message: string;
}

export interface LoadConfigResult {
  config: import('./config.js').KilnConfig | null;
  diagnostics: Diagnostic[];
}