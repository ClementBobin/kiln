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
};

export interface Structures {
    [key: string]: Structure;
    templates?: Template;
}