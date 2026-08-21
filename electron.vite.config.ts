import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

const RENDERER_CONNECT_SRC_TOKEN = '__BANDAL_RENDERER_CONNECT_SOURCES__'
const PRODUCTION_RENDERER_CONNECT_SOURCES = "'self'"
const DEVELOPMENT_RENDERER_CONNECT_SOURCES =
  `${PRODUCTION_RENDERER_CONNECT_SOURCES} ws://localhost:* ws://127.0.0.1:*`

function rendererConnectSrcPlugin(
  mode: 'build' | 'serve',
  sources: string
): Plugin {
  return {
    name: `bandal-renderer-connect-src-${mode}`,
    apply: mode,
    transformIndexHtml(html) {
      if (!html.includes(RENDERER_CONNECT_SRC_TOKEN)) {
        throw new Error('[renderer-csp] connect-src placeholder is missing')
      }
      return html.replaceAll(RENDERER_CONNECT_SRC_TOKEN, sources)
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [
      rendererConnectSrcPlugin('build', PRODUCTION_RENDERER_CONNECT_SOURCES),
      rendererConnectSrcPlugin('serve', DEVELOPMENT_RENDERER_CONNECT_SOURCES),
      react()
    ],
    resolve: {
      // Milkdown Slice/Timer identity is a per-module-instance Symbol — TWO
      // bundled copies of core silently reject editor.create() (the v0.13.0
      // dead-toolbar bug). Force a single instance no matter what the
      // dependency tree resolves.
      dedupe: [
        '@milkdown/core',
        '@milkdown/ctx',
        '@milkdown/utils',
        '@milkdown/prose',
        '@milkdown/transformer',
        '@milkdown/exception'
      ]
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay.html')
        }
      }
    }
  }
})
