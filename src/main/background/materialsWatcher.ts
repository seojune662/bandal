import { app, utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type { MaterialChanges, MaterialsWatcher, MaterialsWatcherDeps } from '../features/materials/watcher'

/** Chokidar's initial walk and event bursts stay outside Electron's main loop. */
export function createBackgroundMaterialsWatcher(deps: MaterialsWatcherDeps): MaterialsWatcher {
  const folders = new Map<string, string>()
  let child: UtilityProcess | null = null
  let retry: NodeJS.Timeout | null = null
  let stopped = false
  const restart = (): void => {
    if (stopped || retry || !folders.size) return
    retry = setTimeout(() => { retry = null; start() }, 1000)
    retry.unref()
  }
  const start = (): void => {
    if (child || stopped || !folders.size) return
    try {
      const process = utilityProcess.fork(join(__dirname, 'watcherHost.js'), [], { serviceName: 'Bandal File Watcher', stdio: 'pipe' })
      child = process
      process.stdout?.on('data', () => undefined)
      process.stderr?.on('data', () => undefined)
      process.on('exit', () => { if (child === process) { child = null; restart() } })
      process.on('message', (message: MaterialChanges & { courseId: string; folder: string }) => {
        if (child !== process || !folders.has(message.courseId) || folders.get(message.courseId) !== message.folder) return
        if (message.structural || message.paths.some(path => !deps.ignoreContentChange?.(message.courseId, path))) {
          deps.onChange(message.courseId, message)
        }
      })
      for (const [courseId, folder] of folders) process.postMessage({ action: 'watch', courseId, folder })
    } catch (error) {
      const failed = child
      child = null
      failed?.kill()
      console.warn('[materials] watcher process unavailable', error)
      restart()
    }
  }
  const send = (action: 'watch' | 'unwatch', courseId: string, folder?: string): void => {
    if (!child) { start(); return }
    try { child.postMessage({ action, courseId, folder }) }
    catch { const failed = child; child = null; failed.kill(); restart() }
  }
  const dispose = (): void => {
    stopped = true
    folders.clear()
    if (retry) clearTimeout(retry)
    const old = child
    child = null
    old?.kill()
  }
  app.once('will-quit', dispose)
  return {
    watch(courseId) {
      if (stopped) return
      let folder: string
      try { folder = deps.getCourseFolder(courseId) } catch { return }
      if (folders.get(courseId) === folder) return
      folders.set(courseId, folder)
      send('watch', courseId, folder)
    },
    unwatch(courseId) { if (folders.delete(courseId)) send('unwatch', courseId) },
    dispose
  }
}
