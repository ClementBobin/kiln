/**
 * validate.ts — Validates a kiln config.json and prints typed diagnostics.
 *
 * Usage:
 *   kiln validate ./my-config/config.json
 *   kiln validate ./my-config/config.jsonc
 */
declare function runValidate(filePath: string): void;

export { runValidate };
