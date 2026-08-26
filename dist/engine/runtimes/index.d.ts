import { K as KilnConfig, R as RuntimeName } from '../../structure-DvqNNBvs.js';
import { a as ScaffoldOptions, S as ScaffoldEvent } from '../../scaffold-yj6cHCLX.js';

/**
 * runtimes/index.ts
 *
 * Resolves the correct runtime engine for a config and exposes a single
 * scaffold() entry point used by all CLI commands.
 *
 * Runtime resolution order:
 *   1. config.runtime (explicit)
 *   2. Inferred from tags / structure / source commands
 *   3. Default: node
 */

declare function inferRuntime(config: KilnConfig): RuntimeName;
declare function scaffold(options: ScaffoldOptions): AsyncGenerator<ScaffoldEvent>;

export { inferRuntime, scaffold };
