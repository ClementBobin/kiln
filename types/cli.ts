/**
 * types/cli.ts
 *
 * Option shapes passed to each CLI command handler.
 */

export interface PickOptions {
  output?: string;
  extraConfigs?: string[];
}

export interface HeadlessOptions {
  configId: string;
  vars: string[];
  output?: string;
  extraConfigs?: string[];
}

export interface ListOptions {
  extraConfigs?: string[];
}