/**
 * The download state machine. Electron's DownloadItem is faked so this runs
 * without a browser session — the pattern sessionStore.ts established.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createDownloadHandler,
  downloadFileName,
  type BrowserDownloadUpdate
} from '../../../src/main/features/browser/downloads'

type Listener = (event: unknown, state: string) => void

class FakeItem {
  savePath = ''
  received = 0
  private listeners = new Map<string, Listener>()

  constructor(
    private readonly fileName: string,
    private readonly total = 1024
  ) {}

  getFilename(): string {
    return this.fileName
  }
  getTotalBytes(): number {
    return this.total
  }
  getReceivedBytes(): number {
    return this.received
  }
  setSavePath(path: string): void {
    this.savePath = path
  }
  getSavePath(): string {
    return this.savePath
  }
  on(name: string, listener: Listener): this {
    this.listeners.set(name, listener)
    return this
  }
  fire(name: string, state: string): void {
    this.listeners.get(name)?.(null, state)
  }
  /** Pretend Chromium streamed the bytes to savePath. */
  writeBytes(body = 'pdf-bytes'): void {
    writeFileSync(this.savePath, body)
    this.received = body.length
  }
}

describe('downloadFileName', () => {
  test('strips path separators and control characters', () => {
    expect(downloadFileName('a/b\\c.pdf')).toBe('a b c.pdf')
    expect(downloadFileName('week 3.pdf')).toBe('week 3.pdf')
  })

  test('falls back when the name is empty after cleaning', () => {
    expect(downloadFileName('   ')).toBe('다운로드')
    expect(downloadFileName('/')).toBe('다운로드')
  })

  test('keeps Korean names intact', () => {
    expect(downloadFileName('3주차 강의자료.pdf')).toBe('3주차 강의자료.pdf')
  })
})

describe('download handler', () => {
  let root: string
  let updates: BrowserDownloadUpdate[]
  let adopted: Array<{ fileName: string; sourcePath: string }>

  function handler(
    over: Partial<Parameters<typeof createDownloadHandler>[0]> = {}
  ) {
    return createDownloadHandler({
      stagingRoot: join(root, 'staging'),
      getTargetCourseId: () => 'course-1',
      adoptFile: (input) => {
        adopted.push({ fileName: input.fileName, sourcePath: input.sourcePath })
        return { relPath: input.fileName }
      },
      emit: (update) => updates.push(update),
      now: () => 0,
      ...over
    })
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bandal-dl-'))
    updates = []
    adopted = []
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('stages outside the course folder, then adopts on completion', () => {
    const item = new FakeItem('3주차.pdf')
    handler()(item as never, 7)

    // Partial bytes must never appear in the course folder: the materials
    // watcher would surface a half-written "lecture PDF" in the tree.
    expect(item.savePath).toContain(join(root, 'staging'))
    expect(adopted).toHaveLength(0)

    item.writeBytes()
    item.fire('done', 'completed')

    expect(adopted).toEqual([
      { fileName: '3주차.pdf', sourcePath: item.savePath }
    ])
    const last = updates.at(-1)
    expect(last?.state).toBe('completed')
    expect(last?.relPath).toBe('3주차.pdf')
    expect(last?.courseId).toBe('course-1')
  })

  test('calls the completion hook after reporting success', () => {
    const onCompleted = vi.fn(() => {
      expect(updates.at(-1)?.state).toBe('completed')
    })
    const item = new FakeItem('3주차.pdf')
    handler({ onCompleted })(item as never, 7)
    item.writeBytes()

    item.fire('done', 'completed')

    expect(onCompleted).toHaveBeenCalledWith('3주차.pdf')
  })

  test('cleans up staging whatever the outcome', () => {
    const item = new FakeItem('x.pdf')
    handler()(item as never, 1)
    item.writeBytes()
    item.fire('done', 'completed')
    // Nothing left behind: a large video must not linger in temp.
    expect(existsSync(item.savePath)).toBe(false)
  })

  test('a cancelled download files nothing and reports itself', () => {
    const item = new FakeItem('x.pdf')
    handler()(item as never, 1)
    item.fire('done', 'cancelled')

    expect(adopted).toHaveLength(0)
    expect(updates.at(-1)?.state).toBe('cancelled')
  })

  test('an interrupted download is not treated as a success', () => {
    const item = new FakeItem('x.pdf')
    handler()(item as never, 1)
    item.fire('done', 'interrupted')

    expect(adopted).toHaveLength(0)
    expect(updates.at(-1)?.state).toBe('interrupted')
  })

  test('a transfer that cannot be filed says so instead of claiming success', () => {
    const item = new FakeItem('x.pdf')
    handler({
      adoptFile: () => {
        throw new Error('course folder is gone')
      }
    })(item as never, 1)
    item.writeBytes()
    item.fire('done', 'completed')

    const last = updates.at(-1)
    expect(last?.state).toBe('interrupted')
    expect(last?.failureReason).toContain('course folder is gone')
    expect(last?.relPath).toBeNull()
  })

  test('with no course selected it leaves the download to the OS', () => {
    const item = new FakeItem('x.pdf')
    handler({ getTargetCourseId: () => null })(item as never, 1)

    // No save path forced, so Chromium uses its default — and we still tell
    // the student it happened rather than dropping it silently.
    expect(item.savePath).toBe('')
    expect(updates).toHaveLength(1)
    expect(updates[0]?.courseId).toBeNull()
  })

  test('throttles progress so a big file does not flood the renderer', () => {
    const clock = vi.fn(() => 0)
    const item = new FakeItem('big.mp4', 300_000_000)
    handler({ now: clock, progressIntervalMs: 200 })(item as never, 1)
    updates.length = 0

    for (let i = 0; i < 50; i += 1) item.fire('updated', 'progressing')
    expect(updates).toHaveLength(0) // clock never advanced

    clock.mockReturnValue(500)
    item.fire('updated', 'progressing')
    expect(updates).toHaveLength(1)
  })

  test('carries the originating guest so the UI can attribute it', () => {
    const item = new FakeItem('x.pdf')
    handler()(item as never, 42)
    expect(updates[0]?.webContentsId).toBe(42)
  })
})
