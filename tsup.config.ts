import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    'commands/list': 'src/commands/list.ts',
    'commands/pick': 'src/commands/pick.ts',
    'commands/run': 'src/commands/run.ts',
    'commands/validate': 'src/commands/validate.ts',
    'engine/config-loader': 'src/engine/config-loader.ts',
    'engine/scaffolder': 'src/engine/scaffolder.ts',
    'engine/schema': 'src/engine/schema.ts',
  },
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  bundle: false,
});