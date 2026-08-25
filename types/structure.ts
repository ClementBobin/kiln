/**
 * types/structure.ts
 *
 * Types for the project structure.
 */

export type Template = string[];

export interface FolderConfig {
    templates?: Template;
}

export interface Structure {
    type?: string;
    folders?: (string | Record<string, FolderConfig>)[];
    references?: string[];
    templates?: Template;
    args?: string[];
};

export type StructureEntry = string | Record<string, FolderConfig>;

export type Structures =
    | (Record<string, Structure> & { templates?: Template })
    | StructureEntry[];