import { K as KilnConfig } from './structure-DvqNNBvs.js';

/**
 * types/scaffold.ts
 *
 * Types for events emitted by the scaffold async generator.
 */

type ScaffoldEventStatus = 'running' | 'ok' | 'error' | 'info' | 'warning';
interface ScaffoldEvent {
    status: ScaffoldEventStatus;
    message: string;
}
interface ScaffoldOptions {
    config: KilnConfig;
    /** Directory where the config file lives (used for local sources) */
    configDir: string;
    variables: Record<string, string>;
    outputDir: string;
}

export type { ScaffoldEvent as S, ScaffoldOptions as a };
