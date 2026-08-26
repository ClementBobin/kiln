import path from "node:path";
import fs from "node:fs";
import { BaseRuntimeEngine } from "./base.runtime.js";
function dotnetTemplate(type, lib) {
  switch (type) {
    case "web-api":
      return "webapi";
    case "unit-test":
      return lib ?? "xunit";
    case "class-library":
    case "classlib":
      return "classlib";
    default:
      return "classlib";
  }
}
class DotNetRuntimeEngine extends BaseRuntimeEngine {
  name = "dotnet";
  async *handleStructure(config, vars, outputDir) {
    const structure = config.structure;
    if (!structure || typeof structure !== "object" || Array.isArray(structure)) {
      yield { status: "error", message: "dotnet runtime: config.structure must be a project map" };
      return;
    }
    const projectName = vars["project_name"] ?? "MyProject";
    const netVersion = vars["dotnet_version"] ?? "8";
    const enableTest = vars["enable_test"] === "true";
    const solutionRoot = path.join(outputDir, projectName);
    fs.mkdirSync(solutionRoot, { recursive: true });
    yield { status: "running", message: `Creating solution ${projectName}.sln` };
    const slnCode = await this.runCommand(`dotnet new sln -n ${projectName}`, solutionRoot);
    if (slnCode !== 0) {
      yield { status: "error", message: "Failed to create solution file" };
      return;
    }
    yield { status: "ok", message: `Solution ${projectName}.sln created` };
    const allProjNames = Object.keys(structure);
    for (const [rawName, details] of Object.entries(structure)) {
      if (!enableTest && rawName.endsWith(".Tests")) {
        yield { status: "info", message: `Skipping test project ${rawName} (enable_test=false)` };
        continue;
      }
      const projName = `${projectName}.${rawName}`;
      const projDir = path.join(solutionRoot, projName);
      fs.mkdirSync(projDir, { recursive: true });
      const template = dotnetTemplate(details.type, details.lib);
      yield { status: "running", message: `Creating project ${projName} (${template})` };
      const args = [`dotnet new ${template}`, `-n ${projName}`, `-f net${netVersion}.0`, "--force"];
      if (details.args?.length) args.push(...details.args);
      const createCode = await this.runCommand(args.join(" "), projDir);
      const nestedDir = path.join(projDir, projName);
      if (fs.existsSync(nestedDir) && fs.statSync(nestedDir).isDirectory()) {
        for (const file of fs.readdirSync(nestedDir)) {
          fs.renameSync(path.join(nestedDir, file), path.join(projDir, file));
        }
        fs.rmdirSync(nestedDir);
      }
      if (createCode !== 0) {
        yield { status: "error", message: `Failed to create project ${projName}` };
        return;
      }
      for (const folderEntry of details.folders ?? []) {
        const folderName = typeof folderEntry === "string" ? folderEntry : Object.keys(folderEntry)[0];
        if (folderName) {
          fs.mkdirSync(path.join(projDir, folderName), { recursive: true });
          fs.writeFileSync(path.join(projDir, folderName, ".gitkeep"), "");
        }
      }
      const csprojRel = path.join(projName, `${projName}.csproj`);
      await this.runCommand(`dotnet sln add "${csprojRel}"`, solutionRoot);
      yield { status: "ok", message: `${projName} added to solution` };
    }
    for (const [rawName, details] of Object.entries(structure)) {
      if (!enableTest && rawName.endsWith(".Tests")) continue;
      if (!details.references?.length) continue;
      const projName = `${projectName}.${rawName}`;
      const projDir = path.join(solutionRoot, projName);
      for (const rawRef of details.references) {
        if (!allProjNames.includes(rawRef)) continue;
        if (!enableTest && rawRef.endsWith(".Tests")) continue;
        const refName = `${projectName}.${rawRef}`;
        const refRelPath = path.join("..", refName, `${refName}.csproj`);
        yield { status: "running", message: `Reference: ${projName} \u2192 ${refName}` };
        const refCode = await this.runCommand(`dotnet add reference "${refRelPath}"`, projDir);
        if (refCode !== 0) {
          yield { status: "warning", message: `Could not add reference ${projName} \u2192 ${refName}` };
        }
      }
    }
    yield { status: "ok", message: "All project references wired" };
    yield { status: "running", message: "Restoring NuGet packages" };
    await this.runCommand(`dotnet restore ${projectName}.sln`, solutionRoot);
    yield { status: "ok", message: "NuGet packages restored" };
  }
}
export {
  DotNetRuntimeEngine
};
//# sourceMappingURL=dotnet.js.map