export interface RuntimeEngine {
  name: string;
  validateConfig(config: any): Diagnostic[];
  scaffoldProject(options: ScaffoldOptions): AsyncGenerator<ScaffoldEvent>;
}