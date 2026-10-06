import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const windows = vi.hoisted(() => ({ all: [] as any[], directory: '' }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    app: { getPath: () => windows.directory },
    BrowserWindow: class extends EventEmitter {
      destroyed = false
      webContents = Object.assign(new EventEmitter(), { print: vi.fn() })
      loadFile = vi.fn(async () => {})
      show = vi.fn()
      constructor() { super(); windows.all.push(this) }
      isDestroyed() { return this.destroyed }
      close() { this.destroyed = true; this.emit('closed') }
    }
  }
})
import { printPdfBytes } from '../../../src/main/features/print/printWindow'
beforeEach(() => { windows.all = []; windows.directory = mkdtempSync(join(tmpdir(), 'bandal-print-test-')) })
afterEach(() => rmSync(windows.directory, { recursive: true, force: true }))

test('settles a cancelled print when its window closes before Chromium calls back', async () => {
  const result = printPdfBytes({ bytes: Buffer.from('%PDF-1.4'), jobName: 'test', parent: null })
  windows.all[0].emit('ready-to-show')
  windows.all[0].close()
  await expect(result).resolves.toEqual({ printed: false })
  expect(readdirSync(join(windows.directory, 'bandal-print'))).toEqual([])
})
test('preserves a successful print result despite the window cleanup event', async () => {
  const result = printPdfBytes({ bytes: Buffer.from('%PDF-1.4'), jobName: 'test', parent: null })
  windows.all[0].webContents.print.mockImplementation((_options: unknown, done: (value: boolean) => void) => done(true))
  windows.all[0].emit('ready-to-show')
  await expect(result).resolves.toEqual({ printed: true })
})
test('settles synchronous platform print errors and cleans up the preview window', async () => {
  const result = printPdfBytes({ bytes: Buffer.from('%PDF-1.4'), jobName: 'test', parent: null })
  windows.all[0].webContents.print.mockImplementation(() => { throw new Error('printer unavailable') })
  windows.all[0].emit('ready-to-show')
  await expect(result).resolves.toEqual({ printed: false })
  expect(windows.all[0].isDestroyed()).toBe(true)
})
