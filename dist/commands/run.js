import path from "node:path";
import fs from "node:fs";
import readline from "node:readline";
import chalk from "chalk";
import { buildConfigTree, findNodeById, loadConfigFile } from "../engine/config-loader.js";
import { scaffold } from "../engine/runtimes/index.js";
import console from "node:console";
import process from "node:process";
function printDiagnostic(d) {
  if (d.level === "error") {
    console.error(
      chalk.red(`  \u2716 [error]   ${d.message}`) + (d.path ? chalk.dim(` (${d.path})`) : "")
    );
  } else {
    console.warn(
      chalk.yellow(`  \u26A0 [warning] ${d.message}`) + (d.path ? chalk.dim(` (${d.path})`) : "")
    );
  }
}
async function promptLine(label, defaultVal) {
  if (!process.stdin.isTTY) return defaultVal;
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`  ${label} [${defaultVal}]: `, (ans) => {
      rl.close();
      resolve(ans.trim() || defaultVal);
    });
  });
}
async function runHeadless(opts) {
  const outputDir = path.resolve(opts.output ?? process.cwd());
  if (!fs.existsSync(outputDir)) {
    console.error(chalk.red(`\u2716 Output directory does not exist: ${outputDir}`));
    process.exit(1);
  }
  const tree = buildConfigTree(opts.extraConfigs ?? []);
  const leaf = findNodeById(tree, opts.configId);
  if (!leaf) {
    console.error(chalk.red(`\u2716 Unknown config id: "${opts.configId}"`));
    console.error(chalk.dim("  Run `kiln list` to see available config ids."));
    process.exit(1);
  }
  const { config, diagnostics } = loadConfigFile(leaf.configPath);
  for (const d of diagnostics) {
    printDiagnostic(d);
  }
  if (diagnostics.some((d) => d.level === "error")) {
    console.error(chalk.red("\n\u2716 Config has errors, cannot scaffold."));
    process.exit(1);
  }
  if (!config) {
    console.error(chalk.red("\u2716 Config could not be loaded."));
    process.exit(1);
  }
  const variables = {};
  for (const v of opts.vars ?? []) {
    if (!v.includes("=")) {
      console.error(chalk.red(`\u2716 Invalid --var "${v}" \u2014 expected key=value`));
      process.exit(1);
    }
    const [key, ...rest] = v.split("=");
    variables[key.trim()] = rest.join("=");
  }
  for (const vDef of config.variables ?? []) {
    if (vDef.key && !(vDef.key in variables)) {
      variables[vDef.key] = await promptLine(vDef.label ?? vDef.key, vDef.default ?? "");
    }
  }
  console.log();
  console.log(chalk.bold(`\u25B6 Scaffolding ${chalk.cyan(config.name)} into ${chalk.green(outputDir)}`));
  console.log();
  const icons = {
    running: "\u23F3",
    ok: "\u2705",
    error: "\u2716",
    info: "\u2139",
    warning: "\u26A0"
  };
  let hasError = false;
  for await (const event of scaffold({
    config,
    configDir: leaf.filePath,
    variables,
    outputDir
  })) {
    const icon = icons[event.status] ?? "\u2022";
    if (event.status === "error") {
      console.error(`${chalk.red(icon)} ${chalk.red(event.message)}`);
      hasError = true;
    } else if (event.status === "info") {
      console.log(`${chalk.blue(icon)} ${chalk.dim(event.message)}`);
    } else {
      console.log(`${icon} ${event.message}`);
    }
  }
  process.exit(hasError ? 1 : 0);
}
export {
  runHeadless
};
//# sourceMappingURL=run.js.map