/**
 * JSON Schema for kiln config.json files.
 * Used to validate user-provided configs and emit typed warnings/errors.
 */

import type { SchemaObject } from 'ajv';

export const configSchema: SchemaObject = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['name'],
  anyOf: [
    { required: ['source'] },
    { required: ['structure'] },
  ],
  additionalProperties: true,
  properties: {
    name: {
      type: 'string',
      minLength: 1,
      description: 'Display name for this config',
    },
    description: {
      type: 'string',
      description: 'Short description shown in the picker',
    },
    version: {
      type: 'string',
      pattern: '^\\d+\\.\\d+\\.\\d+$',
      description: 'Semantic version, e.g. "1.0.0"',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Tags for filtering/search',
    },
    runtime: {
      type: 'string',
      enum: ['node', 'dotnet', 'kotlin', 'android'],
      description: 'Runtime engine to use. Inferred when absent.',
    },
    source: {
      type: 'object',
      required: ['type'],
      description: 'How the project is created',
      properties: {
        type: {
          type: 'string',
          enum: ['command', 'local', 'github', 'script'],
          description: 'Source strategy: "command" | "local" | "github" | "script"',
        },
        commands: {
          type: 'array',
          items: {
            type: 'object',
            required: ['cmd'],
            properties: {
              cmd: { type: 'string' },
              label: { type: 'string' },
            },
          },
        },
        repo: { type: 'string' },
        ref: { type: 'string' },
        path: { type: 'string' },
      },
    },
    variables: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key'],
        properties: {
          key: { type: 'string', minLength: 1 },
          label: { type: 'string' },
          default: { type: 'string' },
          choices: {
            type: 'array',
            items: { type: 'string' },
          },
          required: { type: 'boolean' },
        },
      },
    },
    code_conventions: {
      type: 'object',
      properties: {
        editorconfig: { type: 'boolean' },
        linter: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            type: {
              type: 'string',
              enum: ['eslint', 'biome', 'oxc', 'pylint', 'ruff', 'ktlint', 'detekt', 'swiftlint', 'roslyn'],
            },
            config_file: { type: 'string' },
          },
        },
        formatter: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            type: {
              type: 'string',
              enum: ['prettier', 'biome', 'black', 'ruff', 'ktlint', 'swiftformat', 'dotnet-format'],
            },
          },
        },
        commit_conventions: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            tool: { type: 'string' },
            config_file: { type: 'string' },
            hooks: { type: 'string' },
          },
        },
      },
    },
    docker: {
      type: 'object',
      properties: {
        target_stage: { type: 'string' },
      },
    },
    cicd: {
      type: 'object',
      properties: {
        workflows: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
    pipeline: {
      type: 'array',
      items: {
        type: 'string',
        enum: ['build', 'test', 'format'],
      },
    },
    post_init: {
      type: 'array',
      items: {
        type: 'object',
        required: ['cmd'],
        properties: {
          cmd: { type: 'string' },
          label: { type: 'string' },
        },
      },
    },
    structure: {
      description: 'Directory/template structure (flexible shape)',
    },
    templates: {
      type: 'array',
      items: { type: 'string' },
    },
    plugins: {
      type: 'array',
      items: { type: 'string' },
    },
  },
};