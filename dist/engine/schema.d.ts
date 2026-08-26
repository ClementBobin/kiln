import { SchemaObject } from 'ajv';

/**
 * JSON Schema for kiln config.json files.
 * Used to validate user-provided configs and emit typed warnings/errors.
 */

declare const configSchema: SchemaObject;

export { configSchema };
