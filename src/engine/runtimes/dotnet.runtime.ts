import path from 'node:path';
import fs from 'node:fs';
import { BaseRuntimeEngine } from './base-runtime.js';
import type { ScaffoldEvent } from '../../../types/index.js';

export class DotNetRuntimeEngine extends BaseRuntimeEngine {
  name = 'dotnet';

  async *handleStructureSource(
    source: any,
    vars: Record<string, string>,
    outputDir: string,
    projectName: string
  ): AsyncGenerator<ScaffoldEvent> {
    const structure = source.structure;
    const projectNames = Object.keys(structure);
    
    // Subfolder for the solution to keep it clean (e.g. outputDir/MyApi)
    const solutionRoot = path.join(outputDir, projectName);
    fs.mkdirSync(solutionRoot, { recursive: true });

    const netVersion = vars['dotnet_version'] || '10';

    // 1. Create Solution File
    yield { status: 'running', message: `Creating solution ${projectName}.sln` };
    await this.runCommand(`dotnet new sln -n ${projectName}`, solutionRoot);
    yield { status: 'ok', message: `Solution created` };

    // 2. Create Projects & Folders
    for (const [projName, details] of Object.entries<any>(structure)) {
      const projDir = path.join(solutionRoot, projName);
      fs.mkdirSync(projDir, { recursive: true });

      // Determine template type
      let template = 'classlib';

      yield { status: 'running', message: `Creating project ${projName} (${template})` };
      await this.runCommand(`dotnet new ${template} -n ${projName} -f net${netVersion}.0`, projDir);
      
      // Move project files up one level if dotnet created an extra subfolder
      const nestedDir = path.join(projDir, projName);
      if (fs.existsSync(nestedDir) && fs.statSync(nestedDir).isDirectory()) {
        for (const file of fs.readdirSync(nestedDir)) {
          fs.renameSync(path.join(nestedDir, file), path.join(projDir, file));
        }
        fs.rmdirSync(nestedDir);
      }

      // Add sub-folders specified in schema
      if (details.folders && Array.isArray(details.folders)) {
        for (const folder of details.folders) {
          fs.mkdirSync(path.join(projDir, folder), { recursive: true });
          // Add a dummy .gitkeep or placeholder if needed
          fs.writeFileSync(path.join(projDir, folder, '.gitkeep'), '');
        }
      }

      // Add project to solution
      const projFilePath = path.join(projName, `${projName}.csproj`);
      await this.runCommand(`dotnet sln add "${projFilePath}"`, solutionRoot);
      yield { status: 'ok', message: `Project ${projName} scaffolded and added to solution` };
    }

    // 3. Setup Project References
    for (const [projName, details] of Object.entries<any>(structure)) {
      if (details.references && Array.isArray(details.references)) {
        const projDir = path.join(solutionRoot, projName);
        for (const ref of details.references) {
          if (projectNames.includes(ref)) {
            const refProjPath = path.join('..', ref, `${ref}.csproj`);
            yield { status: 'running', message: `Adding reference: ${projName} -> ${ref}` };
            await this.runCommand(`dotnet add reference "${refProjPath}"`, projDir);
          }
        }
      }
    }
    yield { status: 'ok', message: 'All project references linked successfully' };
  }
}