import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf8')
) as { version?: unknown }

if (typeof packageJson.version !== 'string' || packageJson.version === '') {
  throw new Error('[build] package.json must contain a non-empty version')
}

const APP_VERSION_DEFINE = {
  __APP_VERSION__: JSON.stringify(packageJson.version)
}

const RENDERER_CONNECT_SRC_TOKEN = '__BANDAL_RENDERER_CONNECT_SOURCES__'
// bandal-media: — pdf.js 의 range fetch 가 connect-src 를 탄다. 읽기 전용 +
// 경로 이탈 이중 방어 + 실패 전부 404 인 스킴이라 허용 표면 증가는 무시 가능.
const PRODUCTION_RENDERER_CONNECT_SOURCES = "'self' bandal-media:"
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
    define: APP_VERSION_DEFINE,
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    define: APP_VERSION_DEFINE,
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
          overlay: resolve(__dirname, 'src/renderer/overlay.html'),
          pip: resolve(__dirname, 'src/renderer/pip.html')
        }
      }
    }
  }
})
