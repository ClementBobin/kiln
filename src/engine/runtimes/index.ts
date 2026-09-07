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

import { DotNetRuntimeEngine } from './dotnet.runtime.js';
import { NodeRuntimeEngine }   from './node.runtime.js';
import { KotlinRuntimeEngine } from './kotlin.runtime.js';
import type { ScaffoldOptions, ScaffoldEvent, KilnConfig, RuntimeName } from '../../../types/index.js';
import type { BaseRuntimeEngine } from './base.runtime.js';

// ── Registry ─────────────────────────────────────────────────────────────────

const ENGINES: Record<RuntimeName, () => BaseRuntimeEngine> = {
  dotnet:  () => new DotNetRuntimeEngine(),
  node:    () => new NodeRuntimeEngine(),
  kotlin:  () => new KotlinRuntimeEngine(),
  android: () => new KotlinRuntimeEngine(), // alias
};

// ── Runtime inference ─────────────────────────────────────────────────────────

function inferRuntime(config: KilnConfig): RuntimeName {
  // 1. Explicit
  if (config.runtime && config.runtime in ENGINES) return config.runtime;

  const tags = (config.tags as string[] | undefined) ?? [];

  // 2. Tag-based
  if (tags.some((t) => ['dotnet', 'aspnet', 'csharp', '.net'].includes(t.toLowerCase()))) return 'dotnet';
  if (tags.some((t) => ['node', 'javascript', 'typescript'].includes(t.toLowerCase()))) return 'node';
  if (tags.some((t) => ['android', 'kotlin'].includes(t.toLowerCase()))) return 'kotlin';

  // 3. Structure-only configs: if structure keys look like C# project names → dotnet
  if (!config.source && config.structure && typeof config.structure === 'object' && !Array.isArray(config.structure)) {
    const keys = Object.keys(config.structure as object);
    const looksLikeCsharp = keys.some((k) =>
      ['Api', 'Domain', 'Application', 'Infrastructure', 'Business', 'Entity',
       'Repository', 'WebApplications', 'EntitiesContext'].some((s) => k.includes(s))
    );
    if (looksLikeCsharp) return 'dotnet';
  }

  // 4. Source command heuristics
  const cmds = config.source?.commands?.map((c) => c.cmd).join(' ') ?? '';
  if (/\bdotnet\b/i.test(cmds))     return 'dotnet';
  if (/\bgradle\b|\bandroid\b/i.test(cmds)) return 'kotlin';

  return 'node';
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function* scaffold(options: ScaffoldOptions): AsyncGenerator<ScaffoldEvent> {
  const runtime = inferRuntime(options.config);
  const engine  = ENGINES[runtime]?.() ?? new NodeRuntimeEngine();
  yield { status: 'info', message: `Using runtime: ${engine.name}` };
  yield* engine.scaffold(options);
}

export { inferRuntime };
