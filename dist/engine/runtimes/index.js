import { DotNetRuntimeEngine } from "./dotnet.runtime.js";
import { NodeRuntimeEngine } from "./node.runtime.js";
import { KotlinRuntimeEngine } from "./kotlin.runtime.js";
const ENGINES = {
  dotnet: () => new DotNetRuntimeEngine(),
  node: () => new NodeRuntimeEngine(),
  kotlin: () => new KotlinRuntimeEngine(),
  android: () => new KotlinRuntimeEngine()
  // alias
};
function inferRuntime(config) {
  if (config.runtime && config.runtime in ENGINES) return config.runtime;
  const tags = config.tags ?? [];
  if (tags.some((t) => ["dotnet", "aspnet", "csharp", ".net"].includes(t.toLowerCase()))) return "dotnet";
  if (tags.some((t) => ["android", "kotlin"].includes(t.toLowerCase()))) return "kotlin";
  if (!config.source && config.structure && typeof config.structure === "object" && !Array.isArray(config.structure)) {
    const keys = Object.keys(config.structure);
    const looksLikeCsharp = keys.some(
      (k) => [
        "Api",
        "Domain",
        "Application",
        "Infrastructure",
        "Business",
        "Entity",
        "Repository",
        "WebApplications",
        "EntitiesContext"
      ].some((s) => k.includes(s))
    );
    if (looksLikeCsharp) return "dotnet";
  }
  const cmds = config.source?.commands?.map((c) => c.cmd).join(" ") ?? "";
  if (/\bdotnet\b/i.test(cmds)) return "dotnet";
  if (/\bgradle\b|\bandroid\b/i.test(cmds)) return "kotlin";
  return "node";
}
async function* scaffold(options) {
  const runtime = inferRuntime(options.config);
  const engine = ENGINES[runtime]?.() ?? new NodeRuntimeEngine();
  yield { status: "info", message: `Using runtime: ${engine.name}` };
  yield* engine.scaffold(options);
}
export {
  inferRuntime,
  scaffold
};
//# sourceMappingURL=index.js.map