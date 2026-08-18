import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()],
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
          settings: resolve(__dirname, 'src/renderer/settings.html')
        }
      }
    }
  }
})
