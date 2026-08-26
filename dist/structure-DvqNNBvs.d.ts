/**
 * types/config.ts
 *
 * All shared types for kiln config files (config.json / config.jsonc).
 */

type SourceType = 'command' | 'local' | 'github' | 'script';
type RuntimeName = 'node' | 'dotnet' | 'kotlin' | 'android';
type LinterType = 'eslint' | 'biome' | 'oxc' | 'pylint' | 'ruff' | 'ktlint' | 'detekt' | 'swiftlint' | 'roslyn';
type FormatterType = 'prettier' | 'biome' | 'black' | 'ruff' | 'ktlint' | 'swiftformat' | 'dotnet-format';
interface CommandStep {
    cmd: string;
    label?: string;
}
interface ConfigSource {
    type: SourceType;
    /** For type === 'command' */
    commands?: CommandStep[];
    /** For type === 'github' */
    repo?: string;
    ref?: string;
    /** For type === 'local' */
    path?: string;
}
interface ConfigVariable {
    key: string;
    label?: string;
    default?: string;
    choices?: string[];
    required?: boolean;
}
interface LinterConfig {
    enabled?: boolean;
    type?: LinterType;
    config_file?: string;
}
interface FormatterConfig {
    enabled?: boolean;
    type?: FormatterType;
}
interface CommitConventionsConfig {
    enabled?: boolean;
    tool?: string;
    config_file?: string;
    hooks?: string;
}
interface CodeConventions {
    editorconfig?: boolean;
    linter?: LinterConfig;
    formatter?: FormatterConfig;
    commit_conventions?: CommitConventionsConfig;
}
interface KilnConfig {
    name: string;
    tags?: string[];
    description?: string;
    /** Runtime engine to use. Inferred from source/structure when absent. */
    runtime?: RuntimeName;
    source?: ConfigSource;
    structure?: Structures;
    variables?: ConfigVariable[];
    code_conventions?: CodeConventions;
    post_init?: CommandStep[];
    plugins?: string[];
}

/**
 * types/structure.ts
 *
 * Types for the project structure.
 */
type Template = string[];
interface FolderConfig {
    templates?: Template;
}
interface Structure {
    type?: string;
    folders?: (string | Record<string, FolderConfig>)[];
    references?: string[];
    templates?: Template;
    args?: string[];
}
type StructureEntry = string | Record<string, FolderConfig>;
type Structures = (Record<string, Structure> & {
    templates?: Template;
}) | StructureEntry[];

export type { ConfigSource as C, KilnConfig as K, RuntimeName as R };
