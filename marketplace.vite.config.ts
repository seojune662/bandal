import { defineConfig } from 'vite'
export default defineConfig({
  ssr: { noExternal: ['jszip'] },
  build: {
    outDir: 'out/marketplace',
    ssr: 'server/marketplace/index.ts',
    target: 'node24',
    rollupOptions: { output: { format: 'cjs', entryFileNames: 'server.cjs' } },
  },
})
