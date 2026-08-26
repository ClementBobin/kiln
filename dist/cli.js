import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import chalk from "chalk";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));
function collect(value, previous) {
  return previous.concat([value]);
}
async function run() {
  const program = new Command();
  program.name("kiln").description(chalk.bold("\u{1F525} kiln") + " \u2014 interactive project scaffolding").version(pkg.version, "-v, --version");
  program.option("-o, --output <dir>", "Output directory (default: cwd)").option("-c, --configs <dir>", "Extra configs directory").action(async (opts) => {
    const { runPick } = await import("./commands/pick.js");
    await runPick({
      output: opts.output,
      extraConfigs: opts.configs ? [opts.configs] : []
    });
  });
  program.command("run").description("Scaffold a project non-interactively (CI/scripting mode)").requiredOption("--config-id <id>", 'Slash-separated config id, e.g. "react/vite"').option("-o, --output <dir>", "Output directory (default: cwd)").option("--var <key=value>", "Set a template variable (repeatable)", collect, []).option("-c, --configs <dir>", "Extra configs directory").action(
    async (opts) => {
      const { runHeadless } = await import("./commands/run.js");
      await runHeadless({
        configId: opts.configId,
        vars: opts.var,
        output: opts.output,
        extraConfigs: opts.configs ? [opts.configs] : []
      });
    }
  );
  program.command("list").description("List all available scaffold configs").option("-c, --configs <dir>", "Extra configs directory").action(async (opts) => {
    const { runList } = await import("./commands/list.js");
    runList({ extraConfigs: opts.configs ? [opts.configs] : [] });
  });
  program.command("validate <file>").description("Validate a kiln config.json/config.jsonc file").action(async (file) => {
    const { runValidate } = await import("./commands/validate.js");
    runValidate(file);
  });
  await program.parseAsync(process.argv);
}
export {
  run
};
//# sourceMappingURL=cli.js.map