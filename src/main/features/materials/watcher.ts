/**
 * [M5] Per-course folder watcher backing the live materials tree.
 *
 * `materials:watch(courseId)` starts a chokidar watcher on the course folder;
 * every disk change is debounced (300ms) and surfaced through the `onChange`
 * callback, which registerHandlers turns into a `materials:changed` push.
 * Folder rename/delete out-of-band is non-fatal: chokidar keeps running (it
 * re-attaches if the path reappears) and the final debounced change lets the
 * renderer refresh into an empty tree. Search needs no extra invalidation —
 * `materials:search` rebuilds its index from disk on every call.
 */

import { watch, type FSWatcher } from 'chokidar'
import { basename } from 'node:path'

export const MATERIALS_WATCH_DEBOUNCE_MS = 300

export interface MaterialsWatcher {
  /** Idempotent: re-watching an already-watched course is a no-op. */
  watch(courseId: string): void
  unwatch(courseId: string): void
  dispose(): void
}

export interface MaterialsWatcherDeps {
  /** Absolute course folder for a live course id (throws otherwise). */
  getCourseFolder: (courseId: string) => string
  /** Fired (debounced) whenever the course folder changed on disk. */
  onChange: (courseId: string) => void
  debounceMs?: number
}

interface WatchEntry {
  watcher: FSWatcher
  timer: NodeJS.Timeout | null
}

function isHidden(path: string): boolean {
  return basename(path).startsWith('.')
}

export function createMaterialsWatcher(
  deps: MaterialsWatcherDeps
): MaterialsWatcher {
  const debounceMs = deps.debounceMs ?? MATERIALS_WATCH_DEBOUNCE_MS
  const entries = new Map<string, WatchEntry>()

  function scheduleChange(courseId: string): void {
    const entry = entries.get(courseId)
    if (entry === undefined) return
    if (entry.timer !== null) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.timer = null
      deps.onChange(courseId)
    }, debounceMs)
  }

  function stop(courseId: string): void {
    const entry = entries.get(courseId)
    if (entry === undefined) return
    entries.delete(courseId)
    if (entry.timer !== null) clearTimeout(entry.timer)
    void entry.watcher.close().catch((error: unknown) => {
      console.warn(`[materials] failed to close watcher for ${courseId}:`, error)
    })
  }

  return {
    watch(courseId) {
      if (entries.has(courseId)) return
      let folder: string
      try {
        folder = deps.getCourseFolder(courseId)
      } catch (error) {
        console.warn(`[materials] cannot watch unknown course ${courseId}:`, error)
        return
      }
      const watcher = watch(folder, {
        ignoreInitial: true,
        ignored: isHidden,
        // The folder itself may be renamed/removed while watched; polling for
        // existence is unnecessary — missing paths simply stop emitting.
        ignorePermissionErrors: true
      })
      entries.set(courseId, { watcher, timer: null })
      watcher.on('all', () => scheduleChange(courseId))
      watcher.on('error', (error) => {
        // e.g. the folder disappeared mid-scan. Keep the watcher; surface a
        // change so the renderer refreshes to the (possibly empty) tree.
        console.warn(`[materials] watcher error for ${courseId}:`, error)
        scheduleChange(courseId)
      })
    },

    unwatch(courseId) {
      stop(courseId)
    },

    dispose() {
      for (const courseId of [...entries.keys()]) {
        stop(courseId)
      }
    }
  }
}
