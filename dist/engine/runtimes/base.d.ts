import { K as KilnConfig, C as ConfigSource } from '../../structure-DvqNNBvs.js';
import { D as Diagnostic } from '../../diagnostics-CWnI1OLo.js';
import { S as ScaffoldEvent, a as ScaffoldOptions } from '../../scaffold-yj6cHCLX.js';

/**
 * base.runtime.ts
 *
 * Abstract base class shared by all runtime engines.
 * Provides: interpolation, shell runner, git helpers, source handlers,
 * post_init runner, and the top-level scaffold() generator.
 *
 * Subclasses implement handleStructure() for structure-based scaffolding.
 */

declare abstract class BaseRuntimeEngine {
    abstract name: string;
    /**
     * Scaffold from a structure block (no source).
     * Subclasses override this; default emits an 'info' and does nothing.
     */
    protected handleStructure(config: KilnConfig, vars: Record<string, string>, outputDir: string): AsyncGenerator<ScaffoldEvent>;
    /**
     * Optional extra validation. Return [] if nothing extra to check.
     */
    validateConfig(_config: KilnConfig): Diagnostic[];
    scaffold(opts: ScaffoldOptions): AsyncGenerator<ScaffoldEvent>;
    protected runCommand(cmd: string, cwd: string): Promise<number>;
    protected interpolate(str: string, vars: Record<string, string>): string;
    protected gitInit(cwd: string): Promise<void>;
    protected gitCommit(cwd: string, message?: string): Promise<void>;
    protected handleCommandSource(source: ConfigSource, vars: Record<string, string>, outputDir: string): AsyncGenerator<ScaffoldEvent>;
    protected handleGithubSource(source: ConfigSource, vars: Record<string, string>, outputDir: string): AsyncGenerator<ScaffoldEvent>;
    protected handleLocalSource(source: ConfigSource, vars: Record<string, string>, outputDir: string, configDir: string): AsyncGenerator<ScaffoldEvent>;
    protected copyDir(src: string, dest: string, vars: Record<string, string>): void;
}

export { BaseRuntimeEngine };
