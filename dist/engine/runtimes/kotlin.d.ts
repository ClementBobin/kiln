import { BaseRuntimeEngine } from './base.js';
import { K as KilnConfig } from '../../structure-DvqNNBvs.js';
import { S as ScaffoldEvent } from '../../scaffold-yj6cHCLX.js';
import '../../diagnostics-CWnI1OLo.js';

/**
 * kotlin.runtime.ts
 *
 * Runtime engine for Android / Kotlin projects.
 *
 * Structure-based scaffolding creates the standard Android MVVM
 * directory layout (data/, di/, domain/, ui/) without needing Android Studio.
 * Source-based scaffolding (command / github) delegates to the base class.
 */

declare class KotlinRuntimeEngine extends BaseRuntimeEngine {
    name: string;
    protected handleStructure(config: KilnConfig, vars: Record<string, string>, outputDir: string): AsyncGenerator<ScaffoldEvent>;
}

export { KotlinRuntimeEngine };
