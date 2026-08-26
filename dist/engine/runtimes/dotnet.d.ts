import { BaseRuntimeEngine } from './base.js';
import { K as KilnConfig } from '../../structure-DvqNNBvs.js';
import { S as ScaffoldEvent } from '../../scaffold-yj6cHCLX.js';
import '../../diagnostics-CWnI1OLo.js';

/**
 * dotnet.runtime.ts
 *
 * Handles both structure-based and source-based .NET projects.
 *
 * Structure-based flow (configs with no source block):
 *   Reads config.structure (a map of project-name → ProjectConfig) and
 *   runs the appropriate `dotnet new` template for each entry, creates
 *   sub-folders, wires project references, then adds everything to the solution.
 */

declare class DotNetRuntimeEngine extends BaseRuntimeEngine {
    name: string;
    protected handleStructure(config: KilnConfig, vars: Record<string, string>, outputDir: string): AsyncGenerator<ScaffoldEvent>;
}

export { DotNetRuntimeEngine };
