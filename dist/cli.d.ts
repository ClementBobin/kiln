/**
 * cli.ts — Main CLI entry point.
 *
 * Commands:
 *   kiln                         Interactive picker (default)
 *   kiln run --config-id <id>    Headless scaffold
 *   kiln list                    List available configs
 *   kiln validate <file>         Validate a config.json and print typed diagnostics
 */
declare function run(): Promise<void>;

export { run };
