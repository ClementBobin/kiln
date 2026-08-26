import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import process from "node:process";
class BaseRuntimeEngine {
  // ── Subclass hook ────────────────────────────────────────────────────────────
  /**
   * Scaffold from a structure block (no source).
   * Subclasses override this; default emits an 'info' and does nothing.
   */
  async *handleStructure(config, vars, outputDir) {
    yield { status: "info", message: `Runtime "${this.name}" does not support structure-based scaffolding` };
  }
  /**
   * Optional extra validation. Return [] if nothing extra to check.
   */
  validateConfig(_config) {
    return [];
  }
  // ── Top-level scaffold generator ─────────────────────────────────────────────
  async *scaffold(opts) {
    const { config, configDir, variables: vars, outputDir } = opts;
    if (config.source) {
      switch (config.source.type) {
        case "command":
          yield* this.handleCommandSource(config.source, vars, outputDir);
          break;
        case "github":
          yield* this.handleGithubSource(config.source, vars, outputDir);
          break;
        case "local":
          yield* this.handleLocalSource(config.source, vars, outputDir, configDir);
          break;
        default:
          yield { status: "info", message: `Source type "${config.source.type}" not yet supported` };
      }
    } else if (config.structure) {
      yield* this.handleStructure(config, vars, outputDir);
    }
    for (const step of config.post_init ?? []) {
      const cmd = this.interpolate(step.cmd, vars);
      const label = step.label ? this.interpolate(step.label, vars) : cmd;
      yield { status: "running", message: label };
      const code = await this.runCommand(cmd, outputDir);
      if (code !== 0) {
        yield { status: "error", message: `post_init failed (exit ${code}): ${cmd}` };
      } else {
        yield { status: "ok", message: label };
      }
    }
    try {
      yield { status: "running", message: "Initialising git repository" };
      await this.gitInit(outputDir);
      await this.gitCommit(outputDir);
      yield { status: "ok", message: "Git repository initialised" };
    } catch (err) {
      yield { status: "warning", message: `git init skipped: ${err.message}` };
    }
    yield { status: "info", message: `Done! Project created in ${outputDir}` };
  }
  // ── Shell runner ─────────────────────────────────────────────────────────────
  async runCommand(cmd, cwd) {
    const shell = process.platform === "win32" ? true : "/bin/sh";
    const child = execa(cmd, { cwd, shell, stdio: "inherit" });
    try {
      await child;
      return 0;
    } catch (err) {
      return err.exitCode ?? 1;
    }
  }
  // ── Interpolation ────────────────────────────────────────────────────────────
  interpolate(str, vars) {
    return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? _);
  }
  // ── Git ──────────────────────────────────────────────────────────────────────
  async gitInit(cwd) {
    await execa("git", ["init"], { cwd, stdio: "pipe" });
  }
  async gitCommit(cwd, message = "chore: initial scaffold") {
    await execa("git", ["add", "."], { cwd, stdio: "pipe" });
    try {
      await execa("git", ["commit", "-m", message], { cwd, stdio: "pipe" });
    } catch {
    }
  }
  // ── Source handlers ───────────────────────────────────────────────────────────
  async *handleCommandSource(source, vars, outputDir) {
    for (const step of source.commands ?? []) {
      const cmd = this.interpolate(step.cmd, vars);
      const label = step.label ? this.interpolate(step.label, vars) : cmd;
      yield { status: "running", message: label };
      const code = await this.runCommand(cmd, outputDir);
      if (code !== 0) {
        yield { status: "error", message: `Command failed (exit ${code}): ${cmd}` };
        return;
      }
      yield { status: "ok", message: label };
    }
  }
  async *handleGithubSource(source, vars, outputDir) {
    const repo = this.interpolate(source.repo ?? "", vars);
    const ref = this.interpolate(source.ref ?? "HEAD", vars);
    const cmd = `git clone --depth=1 --branch ${ref} https://github.com/${repo}.git .`;
    yield { status: "running", message: `Cloning ${repo}@${ref}` };
    const code = await this.runCommand(cmd, outputDir);
    if (code !== 0) {
      yield { status: "error", message: `git clone failed for ${repo}` };
      return;
    }
    yield { status: "ok", message: `Cloned ${repo}` };
  }
  async *handleLocalSource(source, vars, outputDir, configDir) {
    const srcPath = source.path ? path.resolve(configDir, this.interpolate(source.path, vars)) : configDir;
    yield { status: "running", message: `Copying from ${srcPath}` };
    try {
      this.copyDir(srcPath, outputDir, vars);
      yield { status: "ok", message: "Files copied" };
    } catch (err) {
      yield { status: "error", message: `Copy failed: ${err.message}` };
    }
  }
  copyDir(src, dest, vars) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destName = this.interpolate(entry.name, vars);
      const destPath = path.join(dest, destName);
      if (entry.isDirectory()) {
        this.copyDir(srcPath, destPath, vars);
      } else {
        let content = fs.readFileSync(srcPath, "utf8");
        content = this.interpolate(content, vars);
        fs.writeFileSync(destPath, content, "utf8");
      }
    }
  }
}
export {
  BaseRuntimeEngine
};
//# sourceMappingURL=base.js.map