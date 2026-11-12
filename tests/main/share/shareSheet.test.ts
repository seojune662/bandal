import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createShareSheet } from '../../../src/main/features/share/shareSheet'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'bandal-share-sheet-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

function sheet(hasShareMenu: boolean) {
  const deps = {
    hasShareMenu,
    resolvePath: vi.fn(async (_courseId: string, relPath: string) => join(dir, relPath)),
    exportAnnotatedPdf: vi.fn(async (_input: unknown, path: string) => writeFile(path, 'annotated')),
    tempRoot: join(dir, 'tmp'),
    copyText: vi.fn(),
    reveal: vi.fn()
  }
  return { deps, share: createShareSheet(deps) }
}

test('macOS shares the material file itself and the page link through the menu', async () => {
  const { share, deps } = sheet(true)
  const menu = vi.fn()
  expect(await share({ kind: 'file', courseId: 'c1', relPath: '강의 정리.md' }, menu)).toBe('menu')
  expect(menu).toHaveBeenLastCalledWith({ filePaths: [join(dir, '강의 정리.md')] })
  expect(await share({ kind: 'url', url: 'https://example.com/a?b=1' }, menu)).toBe('menu')
  expect(menu).toHaveBeenLastCalledWith({ urls: ['https://example.com/a?b=1'] })
  expect(deps.exportAnnotatedPdf).not.toHaveBeenCalled()
})

test('a PDF is shared as an annotated copy under its own name, replaced by the next share', async () => {
  const { share, deps } = sheet(true)
  const menu = vi.fn()
  await share({ kind: 'file', courseId: 'c1', relPath: 'week1/Lecture.pdf', annotatedPdf: true }, menu)
  const first = (menu.mock.calls[0]![0] as { filePaths: string[] }).filePaths[0]!
  expect(basename(first)).toBe('Lecture.pdf')
  expect(dirname(dirname(first))).toBe(join(dir, 'tmp'))
  expect(await readFile(first, 'utf8')).toBe('annotated')
  expect(deps.exportAnnotatedPdf).toHaveBeenCalledWith({ courseId: 'c1', relPath: 'week1/Lecture.pdf' }, first)

  await share({ kind: 'file', courseId: 'c1', relPath: 'week1/Lecture.pdf', annotatedPdf: true }, menu)
  expect(existsSync(first)).toBe(false)
})

test('without a share menu a link is copied and a file is revealed', async () => {
  const { share, deps } = sheet(false)
  const menu = vi.fn()
  expect(await share({ kind: 'url', url: 'https://example.com' }, menu)).toBe('copied')
  expect(deps.copyText).toHaveBeenCalledWith('https://example.com/')
  expect(await share({ kind: 'file', courseId: 'c1', relPath: 'a.png' }, menu)).toBe('revealed')
  expect(deps.reveal).toHaveBeenCalledWith(join(dir, 'a.png'))
  expect(menu).not.toHaveBeenCalled()
})

test('rejects non-web links and malformed targets', async () => {
  const { share } = sheet(true)
  const menu = vi.fn()
  await expect(share({ kind: 'url', url: 'file:///etc/passwd' }, menu)).rejects.toThrow()
  await expect(share({ kind: 'file', courseId: '', relPath: 'a.md' }, menu)).rejects.toThrow()
  await expect(share({ kind: 'nope' } as never, menu)).rejects.toThrow()
  expect(menu).not.toHaveBeenCalled()
})
