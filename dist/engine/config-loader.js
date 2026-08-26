import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseJsonc } from "jsonc-parser";
import { createRequire } from "node:module";
const require2 = createRequire(import.meta.url);
const AjvModule = require2("ajv");
const addFormatsModule = require2("ajv-formats");
const AjvClass = AjvModule.default ?? AjvModule;
const addFormats = addFormatsModule.default ?? addFormatsModule;
import { configSchema } from "./schema.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_CONFIGS = path.resolve(__dirname, "../../configs");
const ajv = new AjvClass({ allErrors: true, strict: false });
addFormats(ajv);
const _validate = ajv.compile(configSchema);
function validateConfig(config) {
  const diagnostics = [];
  const valid = _validate(config);
  if (!valid && _validate.errors) {
    for (const err of _validate.errors) {
      const loc = err.instancePath || "/";
      const isTypeError = err.keyword === "type" || err.keyword === "required" || err.keyword === "minLength" || err.keyword === "enum";
      diagnostics.push({
        level: isTypeError ? "error" : "warning",
        path: loc,
        message: ajv.errorsText([err], { separator: "; ", dataVar: "config" })
      });
    }
  }
  if (!config.source && !config.structure) {
    diagnostics.push({
      level: "error",
      path: "/",
      message: 'Config must have at least one of "source" or "structure" defined'
    });
  }
  if (config.source?.type === "command" && !config.source.commands?.length) {
    diagnostics.push({
      level: "warning",
      path: "/source/commands",
      message: 'source.type is "command" but no commands are defined'
    });
  }
  if (config.variables) {
    const keys = /* @__PURE__ */ new Set();
    for (const v of config.variables) {
      if (keys.has(v.key)) {
        diagnostics.push({
          level: "warning",
          path: "/variables",
          message: `Duplicate variable key "${v.key}"`
        });
      }
      keys.add(v.key);
    }
  }
  return diagnostics;
}
function loadConfigFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const errors = [];
  const config = parseJsonc(raw, errors, { allowTrailingComma: true });
  const diagnostics = [];
  if (errors.length) {
    for (const e of errors) {
      diagnostics.push({
        level: "error",
        path: filePath,
        message: `JSONC parse error at offset ${e.offset}: code ${e.error}`
      });
    }
    return { config: null, diagnostics };
  }
  diagnostics.push(...validateConfig(config));
  return { config, diagnostics };
}
function formatName(folderName) {
  return folderName.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function findManifest(dir) {
  const jsonc = path.join(dir, "config.jsonc");
  if (fs.existsSync(jsonc)) return jsonc;
  const json = path.join(dir, "config.json");
  if (fs.existsSync(json)) return json;
  return null;
}
function getDisplayName(manifestPath, fallback) {
  try {
    const { config } = loadConfigFile(manifestPath);
    return config?.name || fallback;
  } catch {
    return fallback;
  }
}
function isConfigFile(filename) {
  const lower = filename.toLowerCase();
  return lower.startsWith("config") && (lower.endsWith(".json") || lower.endsWith(".jsonc"));
}
function scanDir(dir) {
  const nodes = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).sort(
      (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    );
  } catch {
    return nodes;
  }
  const configFiles = entries.filter((e) => e.isFile() && isConfigFile(e.name));
  const subdirs = entries.filter(
    (e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "__pycache__" && e.name !== "node_modules"
  );
  const standard = configFiles.find((f) => f.name === "config.json" || f.name === "config.jsonc");
  if (standard && configFiles.length === 1) {
    const manifestPath = path.join(dir, standard.name);
    const name = getDisplayName(manifestPath, formatName(path.basename(dir)));
    nodes.push({ name, filePath: dir, isLeaf: true, configPath: manifestPath });
    return nodes;
  }
  if (configFiles.length) {
    const children2 = [];
    for (const cf of configFiles) {
      const manifestPath = path.join(dir, cf.name);
      const fallback = configFiles.length > 1 ? formatName(path.parse(cf.name).name) : formatName(path.basename(dir));
      const name = configFiles.length > 1 ? fallback : getDisplayName(manifestPath, fallback);
      children2.push({ name, filePath: dir, isLeaf: true, configPath: manifestPath });
    }
    for (const sub of subdirs) {
      children2.push(...scanDir(path.join(dir, sub.name)));
    }
    if (children2.length) {
      nodes.push({ name: formatName(path.basename(dir)), filePath: dir, isLeaf: false, children: children2 });
    }
    return nodes;
  }
  const children = [];
  for (const sub of subdirs) {
    children.push(...scanDir(path.join(dir, sub.name)));
  }
  if (children.length) {
    nodes.push({ name: formatName(path.basename(dir)), filePath: dir, isLeaf: false, children });
  }
  return nodes;
}
function buildConfigTree(extraDirs = []) {
  const roots = [BUILTIN_CONFIGS, ...extraDirs];
  const root = { name: "root", filePath: "/", isLeaf: false, children: [] };
  for (const rootDir of roots) {
    if (!fs.existsSync(rootDir)) continue;
    let topLevel;
    try {
      topLevel = fs.readdirSync(rootDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of topLevel.sort(
      (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    )) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      root.children.push(...scanDir(path.join(rootDir, entry.name)));
    }
  }
  return root;
}
function findNodeById(root, id) {
  const parts = id.replace(/^\/|\/$/g, "").split("/").filter(Boolean);
  let node = root;
  for (const part of parts) {
    const match = (node.children ?? []).find((c) => {
      const slug = path.basename(c.filePath);
      return slug === part || slug.toLowerCase().replace(/[-_]/g, " ") === part.toLowerCase().replace(/[-_]/g, " ");
    });
    if (!match) return null;
    node = match;
  }
  return node?.isLeaf ? node : null;
}
export {
  buildConfigTree,
  findNodeById,
  loadConfigFile,
  validateConfig
};
//# sourceMappingURL=config-loader.js.map