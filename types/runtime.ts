import type { ScaffoldEvent, ScaffoldOptions } from './scaffold.js';
import type { Diagnostic } from './diagnostics.js';
import type { KilnConfig } from './config.js';

export interface RuntimeEngine {
  name: string;
  validateConfig(config: KilnConfig): Diagnostic[];
  scaffold(options: ScaffoldOptions): AsyncGenerator<ScaffoldEvent>;
}
