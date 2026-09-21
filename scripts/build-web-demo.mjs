import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version
await build({ configFile: false, root: resolve(root, 'web-demo'), base: '/app-demo/',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [{ name: 'browser-material-urls', enforce: 'pre', resolveId(source, importer) {
    if (source.endsWith('/mediaUrl') && importer?.includes('/src/renderer/')) return resolve(root, 'web-demo/mediaUrl.ts')
  } }, react()],
  resolve: { dedupe: ['@milkdown/core','@milkdown/ctx','@milkdown/utils','@milkdown/prose','@milkdown/transformer','@milkdown/exception'] },
  build: { outDir: 'dist', emptyOutDir: true, reportCompressedSize: false, sourcemap: false }
})
