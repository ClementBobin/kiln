import { BaseRuntimeEngine } from "./base.runtime.js";
class NodeRuntimeEngine extends BaseRuntimeEngine {
  name = "node";
  // All scaffolding flows through BaseRuntimeEngine.scaffold() →
  // handleCommandSource / handleGithubSource / handleLocalSource.
  // No structure override needed for Node projects.
}
export {
  NodeRuntimeEngine
};
//# sourceMappingURL=node.js.map