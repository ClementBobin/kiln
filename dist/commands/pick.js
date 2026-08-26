import path from "node:path";
import fs from "node:fs";
import { select, input } from "@inquirer/prompts";
import chalk from "chalk";
import { buildConfigTree, loadConfigFile } from "../engine/config-loader.js";
import { scaffold } from "../engine/runtimes/index.js";
import console from "node:console";
import process from "node:process";
function printDiagnostics(diagnostics, configPath) {
  if (!diagnostics.length) return;
  console.log();
  for (const d of diagnostics) {
    const prefix = d.level === "error" ? chalk.red("  \u2716 [error]  ") : chalk.yellow("  \u26A0 [warning]");
    const loc = d.path && d.path !== configPath ? chalk.dim(` (at ${d.path})`) : "";
    console.log(`${prefix} ${d.message}${loc}`);
  }
  console.log();
}
async function pickLeaf(node) {
  if (node.isLeaf) return node;
  const choices = (node.children ?? []).map((child) => ({
    name: child.isLeaf ? `  ${child.name}` : `\u25B8 ${child.name}`,
    value: child,
    description: child.isLeaf ? chalk.dim(child.configPath ?? "") : chalk.dim("folder")
  }));
  choices.push({ name: chalk.dim("\u2039 back"), value: null, description: "" });
  const chosen = await select({
    message: chalk.bold("Select a template:"),
    choices,
    pageSize: 16
  });
  if (!chosen) return null;
  return pickLeaf(chosen);
}
async function collectVariables(variables) {
  const result = {};
  for (const v of variables ?? []) {
    if (v.choices?.length) {
      result[v.key] = await select({
        message: chalk.cyan(`${v.label ?? v.key}:`),
        choices: v.choices.map((c) => ({ name: c, value: c })),
        default: v.default
      });
    } else {
      result[v.key] = await input({
        message: chalk.cyan(`${v.label ?? v.key}:`),
        default: v.default ?? "",
        validate: v.required ? (s) => s.trim() ? true : `${v.key} is required` : void 0
      });
    }
  }
  return result;
}
async function runPick(opts = {}) {
  const outputDir = path.resolve(opts.output ?? process.cwd());
  if (!fs.existsSync(outputDir)) {
    console.error(chalk.red(`\u2716 Output directory does not exist: ${outputDir}`));
    process.exit(1);
  }
  const tree = buildConfigTree(opts.extraConfigs ?? []);
  if (!tree.children?.length) {
    console.error(chalk.red("\u2716 No configs found. Check your configs directory."));
    process.exit(1);
  }
  console.log();
  console.log(chalk.bold.magenta("  \u{1F525} kiln") + chalk.dim(" \u2014 project scaffolding"));
  console.log();
  let leaf = null;
  const navNode = tree;
  while (!leaf) {
    const picked = await pickLeaf(navNode);
    if (!picked) {
      console.log(chalk.dim("\n  Cancelled."));
      process.exit(0);
    }
    if (picked.isLeaf) {
      leaf = picked;
    }
  }
  const { config, diagnostics } = loadConfigFile(leaf.configPath);
  if (diagnostics.some((d) => d.level === "error")) {
    console.log(chalk.red.bold("\n  Config has errors \u2014 cannot scaffold:\n"));
    printDiagnostics(diagnostics, leaf.configPath);
    process.exit(1);
  }
  if (diagnostics.some((d) => d.level === "warning")) {
    console.log(chalk.yellow.bold("  Config warnings:"));
    printDiagnostics(diagnostics, leaf.configPath);
  }
  if (!config) {
    console.error(chalk.red("\u2716 Config could not be loaded."));
    process.exit(1);
  }
  if (config.description) {
    console.log(chalk.dim(`  ${config.description}
`));
  }
  const variables = await collectVariables(config.variables);
  console.log();
  console.log(
    chalk.bold(`  Scaffolding `) + chalk.cyan(config.name) + chalk.bold(` into `) + chalk.green(outputDir)
  );
  console.log();
  const icons = {
    running: chalk.yellow("\u23F3"),
    ok: chalk.green("\u2705"),
    error: chalk.red("\u2716"),
    info: chalk.blue("\u2139"),
    warning: chalk.yellow("\u26A0")
  };
  for await (const event of scaffold({
    config,
    configDir: leaf.filePath,
    variables,
    outputDir
  })) {
    const icon = icons[event.status] ?? "\u2022";
    if (event.status === "error") {
      console.log(`  ${icon} ${chalk.red(event.message)}`);
    } else if (event.status === "info") {
      console.log(`  ${icon} ${chalk.dim(event.message)}`);
    } else {
      console.log(`  ${icon} ${event.message}`);
    }
  }
  console.log();
  console.log(chalk.green.bold("  Done! \u{1F389}"));
  console.log();
}
export {
  runPick
};
//# sourceMappingURL=pick.js.map