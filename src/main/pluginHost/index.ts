/** Entry point bundled separately and launched with `utilityProcess.fork`. */

import type { MainToHost } from '../../shared/types/pluginRpc'
import { createHostRuntime } from './runtime'

const parentPort = process.parentPort

const runtime = createHostRuntime({
  post: (message) => parentPort.postMessage(message),
  onMessage: (callback) => {
    parentPort.on('message', (event) => callback(event.data as MainToHost))
  }
})

parentPort.on('message', (event) => {
  const message = event.data as MainToHost
  if (message.t !== 'shutdown') return
  setTimeout(() => {
    runtime.dispose()
    process.exit(0)
  }, 250).unref()
})

process.on('disconnect', () => {
  runtime.dispose()
  process.exit(0)
})
