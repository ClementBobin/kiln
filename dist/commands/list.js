import chalk from "chalk";
import { buildConfigTree, loadConfigFile } from "../engine/config-loader.js";
import console from "node:console";
function printTree(node, prefix = "", isLast = true, isRoot = false) {
  if (!isRoot) {
    const connector = isLast ? "\u2514\u2500 " : "\u251C\u2500 ";
    if (node.isLeaf) {
      const { config } = loadConfigFile(node.configPath);
      const desc = config?.description ? chalk.dim(` \u2014 ${config.description}`) : "";
      console.log(`${prefix}${connector}${chalk.cyan(node.name)}${desc}`);
    } else {
      console.log(`${prefix}${connector}${chalk.bold(node.name)}`);
    }
  }
  if (!node.isLeaf && node.children?.length) {
    const childPrefix = isRoot ? "" : prefix + (isLast ? "   " : "\u2502  ");
    node.children.forEach((child, i) => {
      printTree(child, childPrefix, i === node.children.length - 1);
    });
  }
}
function runList(opts = {}) {
  const tree = buildConfigTree(opts.extraConfigs ?? []);
  console.log();
  console.log(chalk.bold.magenta("  \u{1F525} kiln") + chalk.dim(" \u2014 available configs"));
  console.log();
  if (!tree.children?.length) {
    console.log(chalk.dim("  No configs found."));
    console.log();
    return;
  }
  printTree(tree, "  ", true, true);
  console.log();
  console.log(chalk.dim("  Use: kiln run --config-id <path>   e.g. kiln run --config-id react/vite"));
  console.log();
}
export {
  runList
};
//# sourceMappingURL=list.js.map