import { defineConfig } from 'vite'
export default defineConfig({
  ssr: { noExternal: ['jszip'] },
  build: {
    outDir: 'out/plugin-cli',
    ssr: 'sdk/cli/index.ts',
    target: 'node24',
    rollupOptions: { output: { format: 'cjs', entryFileNames: 'plugin.cjs' } },
  },
})
