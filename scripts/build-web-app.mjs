/**
 * Builds bandal.io/app: the production renderer on the Google Drive read-only
 * adapter in `web-app/`. bandal-web's `tools/sync-app.mjs` copies the output.
 *
 * VITE_GOOGLE_WEB_CLIENT_ID is the public client id of a "Web application"
 * OAuth client in the same Cloud project as the desktop client. Without it
 * the page shows a "coming soon" card instead of sign-in.
 */
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version
await build({ configFile: false, root: resolve(root, 'web-app'), base: '/app/', envDir: root,
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [{ name: 'browser-material-urls', enforce: 'pre', resolveId(source, importer) {
    if (source.endsWith('/mediaUrl') && importer?.includes('/src/renderer/')) return resolve(root, 'web-app/mediaUrl.ts')
  } }, react()],
  resolve: {
    // The sync reader's only Node imports, prepared asynchronously before it runs (web-app/shims).
    alias: { 'node:crypto': resolve(root, 'web-app/shims/node-crypto.ts'), 'node:zlib': resolve(root, 'web-app/shims/node-zlib.ts') },
    dedupe: ['@milkdown/core','@milkdown/ctx','@milkdown/utils','@milkdown/prose','@milkdown/transformer','@milkdown/exception']
  },
  build: { outDir: 'dist', emptyOutDir: true, reportCompressedSize: false, sourcemap: false }
})
