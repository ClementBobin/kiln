/**
 * schema.ts
 *
 * JSON Schema for kiln config.json files.
 * Used by AJV at load-time to emit typed diagnostics.
 */

import type { SchemaObject } from 'ajv';

/** Reusable schema fragment for a CommandStep array (or null to disable). */
const commandStepList: SchemaObject = {
  oneOf: [
    {
      type: 'array',
      items: {
        type: 'object',
        required: ['cmd'],
        additionalProperties: false,
        properties: {
          cmd:      { type: 'string', minLength: 1 },
          label:    { type: 'string' },
          override: { type: 'boolean' },
        },
      },
    },
    { type: 'null' },
  ],
};

/** Source command list — same shape but override is meaningless here (always additive). */
const sourceCommandList: SchemaObject = {
  type: 'array',
  items: {
    type: 'object',
    required: ['cmd'],
    additionalProperties: false,
    properties: {
      cmd:   { type: 'string', minLength: 1 },
      label: { type: 'string' },
    },
  },
};

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
      description: 'Display name shown in the picker',
    },

    description: {
      type: 'string',
      description: 'Short description shown in the picker',
    },

    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Tags used for runtime inference and filtering',
    },

    runtime: {
      type: 'string',
      enum: ['node', 'dotnet', 'kotlin', 'android'],
      description: 'Runtime engine. Inferred from tags/structure when absent.',
    },

    // ── Lifecycle hooks ──────────────────────────────────────────────────────

    check_dependencies: {
      ...commandStepList,
      description:
        'Commands that verify required tools are present (should exit 0 when the tool exists). ' +
        'null = skip all checks (including runtime defaults). ' +
        'Steps with override:true replace runtime defaults; others append after them.',
    },

    pre_init: {
      ...commandStepList,
      description:
        'Commands that run before scaffolding. ' +
        'null = skip (including runtime defaults). ' +
        'Steps with override:true replace runtime defaults; others append after them.',
    },

    post_init: {
      ...commandStepList,
      description:
        'Commands that run after scaffolding (restore, install, format…). ' +
        'null = skip (including runtime defaults). ' +
        'Steps with override:true replace runtime defaults; others append after them.',
    },

    // ── Source ───────────────────────────────────────────────────────────────

    source: {
      type: 'object',
      required: ['type'],
      description: 'How the project skeleton is created',
      properties: {
        type: {
          type: 'string',
          enum: ['command', 'local', 'github', 'script'],
        },
        commands: sourceCommandList,
        repo:     { type: 'string' },
        ref:      { type: 'string' },
        path:     { type: 'string' },
      },
    },

    structure: {
      description: 'Project structure map (runtime-specific shape)',
    },

    // ── Variables ────────────────────────────────────────────────────────────

    variables: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key'],
        properties: {
          key:      { type: 'string', minLength: 1 },
          label:    { type: 'string' },
          default:  { type: 'string' },
          choices:  { type: 'array', items: { type: 'string' } },
          required: { type: 'boolean' },
        },
      },
    },

    // ── Code conventions ─────────────────────────────────────────────────────

    code_conventions: {
      type: 'object',
      properties: {
        editorconfig: { type: 'boolean' },
        linter: {
          type: 'object',
          properties: {
            enabled:     { type: 'boolean' },
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
            enabled:     { type: 'boolean' },
            tool:        { type: 'string' },
            config_file: { type: 'string' },
            hooks:       { type: 'string' },
          },
        },
      },
    },

    plugins: {
      type: 'array',
      items: { type: 'string' },
    },
  },
}