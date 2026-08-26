import { K as KilnConfig } from '../structure-DvqNNBvs.js';
import { L as LoadConfigResult, D as Diagnostic } from '../diagnostics-CWnI1OLo.js';

/**
 * types/tree.ts
 *
 * Types for the config directory tree that kiln builds at runtime.
 */
interface TreeNode {
    name: string;
    /** Absolute path to the directory containing this node */
    filePath: string;
    isLeaf: boolean;
    children?: TreeNode[];
    /** Only present on leaf nodes — absolute path to the config file */
    configPath?: string;
}

/**
 * config-loader.ts
 *
 * Loads kiln config.json / config.jsonc files from the built-in configs
 * directory and from extra user-supplied directories.
 *
 * Validation produces typed diagnostics:
 *   { level: 'error' | 'warning', path: string, message: string }
 *
 * Errors   → config cannot be used (required fields missing / wrong type)
 * Warnings → config will work but something looks suspicious
 */

/**
 * Validate a parsed config object and return typed diagnostics.
 */
declare function validateConfig(config: KilnConfig): Diagnostic[];
/**
 * Load config file (json/jsonc), parse it, validate it.
 * Returns { config, diagnostics }.
 */
declare function loadConfigFile(filePath: string): LoadConfigResult;
/**
 * Build the merged config tree from built-in + extra dirs.
 */
declare function buildConfigTree(extraDirs?: string[]): TreeNode;
/**
 * Walk the tree to find a leaf by slash-separated id, e.g. "react/vite".
 */
declare function findNodeById(root: TreeNode, id: string): TreeNode | null;

export { buildConfigTree, findNodeById, loadConfigFile, validateConfig };
