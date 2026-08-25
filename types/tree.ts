/**
 * types/tree.ts
 *
 * Types for the config directory tree that kiln builds at runtime.
 */

export interface TreeNode {
  name: string;
  /** Absolute path to the directory containing this node */
  filePath: string;
  isLeaf: boolean;
  children?: TreeNode[];
  /** Only present on leaf nodes — absolute path to the config file */
  configPath?: string;
}