/**
 * node.runtime.ts
 *
 * Runtime engine for Node.js / JavaScript / TypeScript projects.
 * Source-based only (command / github / local).
 * Structure-based scaffolding for Node is done via source.commands in the config.
 */

import { BaseRuntimeEngine } from './base.runtime.js';

export class NodeRuntimeEngine extends BaseRuntimeEngine {
  name = 'node';
  // All scaffolding flows through BaseRuntimeEngine.scaffold() →
  // handleCommandSource / handleGithubSource / handleLocalSource.
  // No structure override needed for Node projects.
}
