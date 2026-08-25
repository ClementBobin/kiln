/**
 * types/scaffold.ts
 *
 * Types for events emitted by the scaffold async generator.
 */

import type { KilnConfig } from './config.js';

export type ScaffoldEventStatus = 'running' | 'ok' | 'error' | 'info' | 'warning';

export interface ScaffoldEvent {
  status: ScaffoldEventStatus;
  message: string;
}

export interface ScaffoldOptions {
  runtime: string;
  config: KilnConfig;
  variables: Record<string, string>;
  outputDir: string;
}