/**
 * types/cli.ts
 *
 * Option shapes passed to each CLI command handler.
 */
interface PickOptions {
    output?: string;
    extraConfigs?: string[];
}
interface HeadlessOptions {
    configId: string;
    vars: string[];
    output?: string;
    extraConfigs?: string[];
}
interface ListOptions {
    extraConfigs?: string[];
}

export type { HeadlessOptions as H, ListOptions as L, PickOptions as P };
