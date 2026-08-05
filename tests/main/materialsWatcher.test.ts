import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createMaterialsWatcher,
  type MaterialsWatcher
} from '../../src/main/features/materials'

const DEBOUNCE_MS = 40

/** Polls until `predicate` holds (chokidar events are OS-async). */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 4000
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for watcher event')
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

describe('materialsWatcher', () => {
  let dir: string
  let courseDir: string
  let watcher: MaterialsWatcher
  let changes: string[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bandal-watch-'))
    courseDir = join(dir, 'course')
    mkdirSync(courseDir)
    changes = []
    watcher = createMaterialsWatcher({
      getCourseFolder: (courseId) => {
        if (courseId !== 'c1') throw new Error(`unknown course ${courseId}`)
        return courseDir
      },
      onChange: (courseId) => changes.push(courseId),
      debounceMs: DEBOUNCE_MS
    })
  })

  afterEach(() => {
    watcher.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  test('emits a debounced change when a file appears', async () => {
    // Arrange
    watcher.watch('c1')
    await sleep(200) // let the initial scan settle

    // Act
    writeFileSync(join(courseDir, 'new.pdf'), 'pdf-bytes')

    // Assert
    await waitFor(() => changes.length > 0)
    expect(changes[0]).toBe('c1')
  })

  test('coalesces bursts of changes into few events', async () => {
    // Arrange
    watcher.watch('c1')
    await sleep(200)

    // Act — a burst well inside one debounce window.
    for (let i = 0; i < 5; i += 1) {
      writeFileSync(join(courseDir, `file-${i}.md`), `note ${i}`)
    }

    // Assert
    await waitFor(() => changes.length > 0)
    await sleep(DEBOUNCE_MS * 4)
    expect(changes.length).toBeLessThan(5)
  })

  test('stops emitting after unwatch', async () => {
    // Arrange
    watcher.watch('c1')
    await sleep(200)
    watcher.unwatch('c1')
    await sleep(50)

    // Act
    writeFileSync(join(courseDir, 'late.pdf'), 'pdf')
    await sleep(DEBOUNCE_MS * 6)

    // Assert
    expect(changes).toHaveLength(0)
  })

  test('watching an unknown course is a safe no-op', () => {
    // Act / Assert — must not throw.
    expect(() => watcher.watch('ghost')).not.toThrow()
    expect(() => watcher.unwatch('ghost')).not.toThrow()
  })

  test('survives the course folder being deleted out-of-band', async () => {
    // Arrange — a seeded file so the deletion produces unlink events.
    writeFileSync(join(courseDir, 'seed.pdf'), 'pdf')
    watcher.watch('c1')
    await sleep(200)

    // Act — folder removed while watched.
    rmSync(courseDir, { recursive: true, force: true })

    // Assert — the deletion surfaces as a change, and dispose is clean.
    await waitFor(() => changes.length > 0)
    expect(() => watcher.dispose()).not.toThrow()
  })
})
