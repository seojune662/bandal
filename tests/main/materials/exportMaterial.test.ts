import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { exportMaterial, shareGeneratedMaterial } from '../../../src/main/features/materials/exportMaterial'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'bandal-material-export-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

test('copies the full binary file and preserves its source', async () => {
  const source = join(dir, '사진.png'), output = join(dir, '공유.png')
  const bytes = Buffer.from([0, 1, 254, 255, 64])
  await writeFile(source, bytes)
  const resolvePath = vi.fn(async () => source)
  const chooseDestination = vi.fn(async () => ({ canceled: false, filePath: output }))
  await expect(exportMaterial({ courseId: 'course', relPath: '사진.png' }, { resolvePath, chooseDestination })).resolves.toEqual({ savedPath: output })
  expect(await readFile(output)).toEqual(bytes)
  expect(await readFile(source)).toEqual(bytes)
  expect(resolvePath).toHaveBeenCalledTimes(2)
  expect(chooseDestination).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: '사진.png' }))
})

test('canceling the chooser leaves files untouched', async () => {
  const source = join(dir, 'note.md')
  await writeFile(source, '# 최신 필기')
  const resolvePath = vi.fn(async () => source)
  await expect(exportMaterial({ courseId: 'course', relPath: 'note.md' }, {
    resolvePath, chooseDestination: async () => ({ canceled: true, filePath: undefined })
  })).resolves.toEqual({ savedPath: null })
  expect(resolvePath).toHaveBeenCalledOnce()
  expect(await readFile(source, 'utf8')).toBe('# 최신 필기')
})

test('does not offer an export chooser for a directory', async () => {
  const chooseDestination = vi.fn()
  await expect(exportMaterial({ courseId: 'course', relPath: '.' }, {
    resolvePath: async () => dir, chooseDestination
  })).rejects.toThrow('파일만')
  expect(chooseDestination).not.toHaveBeenCalled()
})

test('refuses an output that resolves to the original source, including symlinks', async () => {
  const source = join(dir, 'note.md'), alias = join(dir, 'alias.md')
  await writeFile(source, '원본')
  await symlink(source, alias)
  for (const output of [source, alias]) {
    await expect(exportMaterial({ courseId: 'course', relPath: 'note.md' }, {
      resolvePath: async () => source,
      chooseDestination: async () => ({ canceled: false, filePath: output })
    })).rejects.toThrow('원본과 다른')
  }
  expect(await readFile(source, 'utf8')).toBe('원본')
})

test('revalidates the source after the chooser to reject moved or inaccessible files', async () => {
  const source = join(dir, 'note.md')
  await writeFile(source, '원본')
  const resolvePath = vi.fn().mockResolvedValueOnce(source).mockRejectedValueOnce(new Error('자료 경로 변경됨'))
  await expect(exportMaterial({ courseId: 'course', relPath: 'note.md' }, {
    resolvePath,
    chooseDestination: async () => ({ canceled: false, filePath: join(dir, 'copy.md') })
  })).rejects.toThrow('자료 경로 변경됨')
  await expect(readFile(join(dir, 'copy.md'))).rejects.toMatchObject({ code: 'ENOENT' })
})

test('publishes an independent copy when the selected destination was a hardlink', async () => {
  const source = join(dir, 'note.md'), output = join(dir, 'copy.md')
  await writeFile(source, '원본')
  await link(source, output)
  await exportMaterial({ courseId: 'course', relPath: 'note.md' }, {
    resolvePath: async () => source,
    chooseDestination: async () => ({ canceled: false, filePath: output })
  })
  await writeFile(output, '공유된 파일에서 수정')
  expect(await readFile(source, 'utf8')).toBe('원본')
})

test('removes a staged copy when publishing fails and preserves the existing destination', async () => {
  const source = join(dir, 'note.md'), destination = join(dir, 'existing-directory')
  await writeFile(source, '원본')
  await mkdir(destination)
  await writeFile(join(destination, 'keep.txt'), '보존')
  await expect(exportMaterial({ courseId: 'course', relPath: 'note.md' }, {
    resolvePath: async () => source,
    chooseDestination: async () => ({ canceled: false, filePath: destination })
  })).rejects.toThrow()
  expect(await readFile(join(destination, 'keep.txt'), 'utf8')).toBe('보존')
  expect((await readdir(dir)).some(name => name.startsWith('.bandal-export-'))).toBe(false)
})

test('canceling a generated PDF or transcript skips rendering and leaves no files', async () => {
  const render = vi.fn(async () => new Uint8Array([1, 2, 3]))
  await expect(shareGeneratedMaterial({ title: '화이트보드', extension: 'pdf', render }, {
    chooseDestination: async () => ({ canceled: true, filePath: undefined })
  })).resolves.toEqual({ savedPath: null })
  expect(render).not.toHaveBeenCalled()
  expect(await readdir(dir)).toEqual([])
})

test('writes a generated transcript only to the chosen destination', async () => {
  const destination = join(dir, 'export.md')
  await expect(shareGeneratedMaterial({ title: '강의/기록', extension: 'md', render: async () => '# 최종 자막' }, {
    chooseDestination: async options => {
      expect(options.defaultPath).toBe('강의-기록.md')
      return { canceled: false, filePath: destination }
    }
  })).resolves.toEqual({ savedPath: destination })
  expect(await readFile(destination, 'utf8')).toBe('# 최종 자막')
  expect(await readdir(dir)).toEqual(['export.md'])
})

test('rendering failures preserve an existing destination', async () => {
  const destination = join(dir, 'export.pdf')
  await writeFile(destination, '기존 공유본')
  await expect(shareGeneratedMaterial({ title: '보드', extension: 'pdf', render: async () => { throw new Error('생성 실패') } }, {
    chooseDestination: async () => ({ canceled: false, filePath: destination })
  })).rejects.toThrow('생성 실패')
  expect(await readFile(destination, 'utf8')).toBe('기존 공유본')
  expect(await readdir(dir)).toEqual(['export.pdf'])
})
