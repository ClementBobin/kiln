import { DotNetRuntimeEngine } from './dotnet.runtime.js';
import type { ScaffoldOptions, ScaffoldEvent } from '../../../types/index.js';

export async function* scaffold(options: ScaffoldOptions): AsyncGenerator<ScaffoldEvent> {
  const runtime = options.config.runtime ?? 'dotnet';
  switch (runtime) {
    case 'dotnet': yield* new DotNetRuntimeEngine().scaffold(options); break;
    default: throw new Error(`Unknown runtime: "${runtime}"`);
  }
}