import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  applySheetEdits,
  prepareDocxTextEdit
} from '../../../src/main/features/agentTools/documentEdit'

const injectedFsFailure = vi.hoisted(() => ({ failNextFsync: false }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    fsyncSync: (...args: Parameters<typeof actual.fsyncSync>) => {
      if (injectedFsFailure.failNextFsync) {
        injectedFsFailure.failNextFsync = false
        throw new Error('injected document fsync failure')
      }
      return actual.fsyncSync(...args)
    }
  }
})

describe('documentEdit atomic writes', () => {
  let directory: string

  beforeEach(() => {
    injectedFsFailure.failNextFsync = false
    directory = mkdtempSync(join(tmpdir(), 'bandal-document-edit-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test('preserves the original xlsx when the atomic replacement fails', async () => {
    const absPath = join(directory, 'grades.xlsx')
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('성적').getCell('A1').value = '원본'
    writeFileSync(absPath, Buffer.from(await workbook.xlsx.writeBuffer()))
    const original = readFileSync(absPath)
    injectedFsFailure.failNextFsync = true

    await expect(
      applySheetEdits({
        absPath,
        sheetName: '성적',
        request: { edits: [{ cell: 'A1', value: '수정' }], appendRows: [] }
      })
    ).rejects.toThrow('injected document fsync failure')

    expect(readFileSync(absPath)).toEqual(original)
    expect(readdirSync(directory).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  test('preserves the original docx when the atomic replacement fails', async () => {
    const absPath = join(directory, 'report.docx')
    const zip = new JSZip()
    zip.file(
      'word/document.xml',
      '<w:document><w:body><w:p><w:r><w:t>원본</w:t></w:r></w:p></w:body></w:document>'
    )
    writeFileSync(absPath, await zip.generateAsync({ type: 'nodebuffer' }))
    const original = readFileSync(absPath)
    const prepared = await prepareDocxTextEdit({
      absPath,
      replacements: [{ find: '원본', replace: '수정' }],
      scope: 'all'
    })
    injectedFsFailure.failNextFsync = true

    await expect(prepared.write()).rejects.toThrow('injected document fsync failure')

    expect(readFileSync(absPath)).toEqual(original)
    expect(readdirSync(directory).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})
