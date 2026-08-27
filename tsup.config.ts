import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'cli':                                  'src/cli.ts',
    'commands/list':                        'src/commands/list.ts',
    'commands/pick':                        'src/commands/pick.ts',
    'commands/run':                         'src/commands/run.ts',
    'commands/validate':                    'src/commands/validate.ts',
    'engine/config-loader':                 'src/engine/config-loader.ts',
    'engine/schema':                        'src/engine/schema.ts',
    'engine/template-loader':              'src/engine/template-loader.ts',
    'engine/runtimes/index':               'src/engine/runtimes/index.ts',
    'engine/runtimes/base.runtime':        'src/engine/runtimes/base.runtime.ts',
    'engine/runtimes/dotnet.runtime':      'src/engine/runtimes/dotnet.runtime.ts',
    'engine/runtimes/node.runtime':        'src/engine/runtimes/node.runtime.ts',
    'engine/runtimes/kotlin.runtime':      'src/engine/runtimes/kotlin.runtime.ts',
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