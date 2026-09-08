/**
 * runtimes/index.ts
 *
 * Resolves the correct runtime engine for a config and exposes a single
 * scaffold() entry point used by all CLI commands.
 *
 * Runtime resolution order:
 *   1. config.engine (explicit enum)
 *   2. Inferred from tags / structure / source commands
 *   3. Default: node
 */

import { DotNetRuntimeEngine } from "./dotnet.runtime.js";
import { NodeRuntimeEngine } from "./node.runtime.js";
import { KotlinRuntimeEngine } from "./kotlin.runtime.js";
import type {
  ScaffoldOptions,
  ScaffoldEvent,
  KilnConfig,
  EngineType,
} from "../../../types/index.js";
import type { BaseRuntimeEngine } from "./base.runtime.js";

// ── Registry ─────────────────────────────────────────────────────────────────

const ENGINES: Record<EngineType, () => BaseRuntimeEngine> = {
  dotnet: () => new DotNetRuntimeEngine(),
  node: () => new NodeRuntimeEngine(),
  kotlin: () => new KotlinRuntimeEngine(),
  android: () => new KotlinRuntimeEngine(), // alias
};

// ── Engine resolution ─────────────────────────────────────────────────────────

/**
 * Resolve the engine for a config.
 *
 * Resolution order:
 *   1. `engine` field (explicit enum) — always wins, no inference needed.
 *   2. Structure-key heuristics       — structure-only configs with C#-shaped keys → dotnet,
 *                                       Android-shaped type field → kotlin/android.
 *   3. Source command heuristics      — presence of `dotnet`, `gradle`, `android` CLI calls.
 *   4. Default: node
 *
 * Tags are intentionally NOT used for engine detection — set `engine` explicitly instead.
 */
export function resolveEngine(config: KilnConfig): EngineType {
  // 1. Explicit engine field — highest priority
  if (config.engine && config.engine in ENGINES) return config.engine;

  // 2. Structure-only heuristics
  if (
    !config.source &&
    config.structure &&
    typeof config.structure === "object" &&
    !Array.isArray(config.structure)
  ) {
    const struct = config.structure as Record<string, unknown>;

    // Android configs have a `type: "android-app"` marker
    if (struct["type"] === "android-app") return "android";

    // C#-shaped top-level keys → dotnet
    const csharpKeys = [
      "Api",
      "Domain",
      "Application",
      "Infrastructure",
      "Business",
      "Entity",
      "Repository",
      "WebApplications",
      "EntitiesContext",
    ];
    if (Object.keys(struct).some((k) => csharpKeys.some((s) => k.includes(s))))
      return "dotnet";
  }

  // 3. Source command heuristics
  const cmds = config.source?.commands?.map((c) => c.cmd).join(" ") ?? "";
  if (/\bdotnet\b/i.test(cmds)) return "dotnet";
  if (/\bgradle\b|\bandroid\b/i.test(cmds)) return "kotlin";

  // 4. Default
  return "node";
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function* scaffold(
  options: ScaffoldOptions,
): AsyncGenerator<ScaffoldEvent> {
  const engineType = resolveEngine(options.config);
  const engine = ENGINES[engineType]?.() ?? new NodeRuntimeEngine();
  yield { status: "info", message: `Using engine: ${engine.name}` };
  yield* engine.scaffold(options);
}
