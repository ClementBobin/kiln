/**
 * list.ts — Lists available scaffold configs.
 */

import chalk from 'chalk';
import { buildConfigTree, loadConfigFile } from '../engine/config-loader.js';
import type { TreeNode } from '../../types/index.js';
import type { ListOptions } from '../../types/index.js';
import console from 'node:console';

function printTree(
  node: TreeNode,
  prefix = '',
  isLast = true,
  isRoot = false
): void {
  if (!isRoot) {
    const connector = isLast ? '└─ ' : '├─ ';
    if (node.isLeaf) {
      const { config } = loadConfigFile(node.configPath!);
      const desc = config?.description ? chalk.dim(` — ${config.description}`) : '';
      console.log(`${prefix}${connector}${chalk.cyan(node.name)}${desc}`);
    } else {
      console.log(`${prefix}${connector}${chalk.bold(node.name)}`);
    }
  }

  if (!node.isLeaf && node.children?.length) {
    const childPrefix = isRoot ? '' : prefix + (isLast ? '   ' : '│  ');
    node.children.forEach((child, i) => {
      printTree(child, childPrefix, i === node.children!.length - 1);
    });
  }
}

export function runList(opts: ListOptions = {}): void {
  const tree = buildConfigTree(opts.extraConfigs ?? []);

  console.log();
  console.log(chalk.bold.magenta('  🔥 kiln') + chalk.dim(' — available configs'));
  console.log();

  if (!tree.children?.length) {
    console.log(chalk.dim('  No configs found.'));
    console.log();
    return;
  }

  printTree(tree, '  ', true, true);
  console.log();
  console.log(chalk.dim('  Use: kiln run --config-id <path>   e.g. kiln run --config-id react/vite'));
  console.log();
}