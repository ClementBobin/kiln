import type { Diagnostic, ScaffoldEvent, ScaffoldOptions } from '../../../types/index.js';

export abstract class BaseRuntimeEngine {
  abstract name: string;

  validate(config: any): Diagnostic[] {
    // Shared validation logic can go here
    return [];
  }

  async *scaffold(options: ScaffoldOptions): AsyncGenerator<ScaffoldEvent> {
    yield { status: 'info', message: `Initializing ${this.name} runtime...` };
  }
}