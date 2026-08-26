import { P as PickOptions } from '../cli-CgIzEp0u.js';

/**
 * pick.ts — Interactive config picker for kiln CLI.
 *
 * Uses @inquirer/prompts to walk the config tree and collect variables,
 * then runs the scaffolder.
 */

declare function runPick(opts?: PickOptions): Promise<void>;

export { runPick };
