import path from "node:path";
import fs from "node:fs";
import chalk from "chalk";
import { loadConfigFile } from "../engine/config-loader.js";
import console from "node:console";
import process from "node:process";
function runValidate(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(chalk.red(`\u2716 File not found: ${resolved}`));
    process.exit(1);
  }
  console.log();
  console.log(chalk.bold(`  Validating: `) + chalk.dim(resolved));
  console.log();
  const { config, diagnostics } = loadConfigFile(resolved);
  if (!config) {
    console.error(chalk.red("  \u2716 [error]  File could not be parsed as JSON/JSONC."));
    for (const d of diagnostics) {
      console.error(chalk.red(`  \u2716 ${d.message}`));
    }
    process.exit(1);
  }
  if (!diagnostics.length) {
    console.log(chalk.green("  \u2714 Config is valid \u2014 no issues found."));
    console.log();
    process.exit(0);
  }
  const errors = diagnostics.filter((d) => d.level === "error");
  const warnings = diagnostics.filter((d) => d.level === "warning");
  for (const d of errors) {
    const loc = d.path && d.path !== resolved ? chalk.dim(` (at ${d.path})`) : "";
    console.log(`  ${chalk.red("\u2716 [error]  ")} ${d.message}${loc}`);
  }
  for (const d of warnings) {
    const loc = d.path && d.path !== resolved ? chalk.dim(` (at ${d.path})`) : "";
    console.log(`  ${chalk.yellow("\u26A0 [warning]")} ${d.message}${loc}`);
  }
  console.log();
  if (errors.length) {
    console.log(chalk.red(`  ${errors.length} error(s), ${warnings.length} warning(s).`));
    process.exit(1);
  } else {
    console.log(chalk.yellow(`  0 errors, ${warnings.length} warning(s).`));
    process.exit(0);
  }
}
export {
  runValidate
};
//# sourceMappingURL=validate.js.map