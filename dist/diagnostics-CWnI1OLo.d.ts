import { K as KilnConfig } from './structure-DvqNNBvs.js';

/**
 * types/diagnostics.ts
 *
 * Types for validation diagnostics emitted during config loading.
 */
type DiagnosticLevel = 'error' | 'warning';
interface Diagnostic {
    level: DiagnosticLevel;
    /** File path or JSON pointer where the issue was found */
    path: string;
    message: string;
}
interface LoadConfigResult {
    config: KilnConfig | null;
    diagnostics: Diagnostic[];
}

export type { Diagnostic as D, LoadConfigResult as L };
