import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { createBoardRepo } from '../../../src/main/features/board/boardRepo'
import { createCanvasRepo } from '../../../src/main/features/canvas/canvasRepo'
import { createCoursesRepo } from '../../../src/main/features/courses/coursesRepo'
import { createMaterialsRepo } from '../../../src/main/features/materials/materialsRepo'
import { createNotesRepo } from '../../../src/main/features/notes/notesRepo'
import {
  parseMaterialEditTargetId,
  restoreMaterialBackup
} from '../../../src/main/features/agentTools/documentBackup'
import {
  createAgentJournal,
  type AgentJournal,
  type UndoHandlers
} from '../../../src/main/features/agentTools/journal'
import {
  createAgentTools,
  type AgentTools,
  type AgentToolsDeps
} from '../../../src/main/features/agentTools/tools'
import { createTestDb, type TestDb } from '../helpers/testDb'

interface Harness {
  ctx: TestDb
  courseId: string
  courseFolder: string
  tools: AgentTools
  deps: AgentToolsDeps
  journal: AgentJournal
}

function makeHarness(): Harness {
  const ctx = createTestDb()
  const dataRoot = join(ctx.dir, 'courses')
  mkdirSync(dataRoot)
  const coursesRepo = createCoursesRepo({ db: ctx.db, getDataRoot: () => dataRoot })
  const course = coursesRepo.create({ name: '문서 편집 과목', color: 'blue' })
  const materialsRepo = createMaterialsRepo({
    db: ctx.db,
    getCourseFolder: (courseId) => coursesRepo.getFolder(courseId),
    revealItem: () => undefined,
    trashItem: async () => undefined
  })
  const notesRepo = createNotesRepo({
    getCourseFolder: (courseId) => coursesRepo.getFolder(courseId)
  })
  const journal = createAgentJournal(ctx.db)
  const deps: AgentToolsDeps = {
    courseId: course.id,
    getTurnId: () => 'turn-1',
    coursesRepo,
    materialsRepo,
    notesRepo,
    boardRepo: createBoardRepo(ctx.db),
    canvasRepo: createCanvasRepo(ctx.db),
    confirm: async () => true,
    // 실제 journal 에 기록해 undoTurn 까지 왕복으로 검증한다.
    journal: { record: (entry) => journal.record(entry) }
  }
  return {
    ctx,
    courseId: course.id,
    courseFolder: course.folderPath,
    tools: createAgentTools(deps),
    deps,
    journal
  }
}

function message(result: CallToolResult): string {
  const block = result.content[0]
  if (block?.type !== 'text') throw new Error('expected a text tool result')
  return block.text
}

function payload<T>(result: CallToolResult): T {
  return JSON.parse(message(result)) as T
}

/** registerHandlers 의 material-edit undo 와 같은 복원 경로. */
function undoHandlersFor(harness: Harness): UndoHandlers {
  const noop = async (): Promise<void> => undefined
  return {
    course: noop,
    material: noop,
    link: noop,
    note: noop,
    task: noop,
    board: noop,
    shape: noop,
    'material-edit': async ({ courseId, targetId }) => {
      const parsed = parseMaterialEditTargetId(targetId)
      if (parsed === null) return
      restoreMaterialBackup({
        courseFolder: harness.deps.coursesRepo.getFolder(courseId),
        relPath: parsed.relPath,
        backupAbs: parsed.backupAbs
      })
    }
  }
}

async function writeXlsx(absPath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('성적')
  sheet.getCell('A1').value = '이름'
  sheet.getCell('B1').value = '점수'
  sheet.getCell('A2').value = '학생'
  sheet.getCell('B2').value = 90
  sheet.getCell('B2').numFmt = '0.00'
  await workbook.xlsx.writeFile(absPath)
}

const DOC_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
  '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>총점은 90점 &amp; 보너스</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t xml:space="preserve">기한: 8월 18일. 기한 엄수.</w:t></w:r></w:p>' +
  '</w:body></w:document>'

async function writeDocx(absPath: string, xml: string = DOC_XML): Promise<void> {
  const zip = new JSZip()
  zip.file('word/document.xml', xml)
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  writeFileSync(absPath, buffer)
}

async function readDocumentXml(absPath: string): Promise<string> {
  const zip = await JSZip.loadAsync(readFileSync(absPath))
  const entry = zip.file('word/document.xml')
  if (entry === null) throw new Error('document.xml missing')
  return entry.async('string')
}

describe('edit_sheet', () => {
  let harness: Harness

  beforeEach(() => {
    harness = makeHarness()
  })

  afterEach(() => {
    harness.ctx.cleanup()
  })

  test('edits cells, stores formulas, clears with null and appends rows', async () => {
    const absPath = join(harness.courseFolder, '성적.xlsx')
    await writeXlsx(absPath)

    const result = await harness.tools.call('edit_sheet', {
      courseId: harness.courseId,
      relPath: '성적.xlsx',
      edits: [
        { cell: 'B2', value: 95 },
        { cell: 'C2', value: '=SUM(B2:B2)' },
        { cell: 'A1', value: null }
      ],
      appendRows: [['평균', 95, null]]
    })

    expect(result.isError).toBeUndefined()
    expect(payload(result)).toMatchObject({
      relPath: '성적.xlsx',
      sheet: '성적',
      edited: 3,
      appended: 1
    })

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(absPath)
    const sheet = workbook.getWorksheet('성적')
    if (sheet === undefined) throw new Error('sheet missing after edit')
    expect(sheet.getCell('B2').value).toBe(95)
    expect(sheet.getCell('C2').formula).toBe('SUM(B2:B2)')
    expect(sheet.getCell('A1').value).toBeNull()
    expect(sheet.getCell('A3').value).toBe('평균')
    expect(sheet.getCell('B3').value).toBe(95)
    // read-modify-write 가 기존 서식을 보존하는지 — numFmt 는 살아남아야 한다.
    expect(sheet.getCell('B2').numFmt).toBe('0.00')

    const actions = harness.journal.forTurn('turn-1').actions
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      tool: 'edit_sheet',
      targetKind: 'material-edit',
      undoable: true
    })
  })

  test('rejects an unknown sheet and lists the sheets that exist', async () => {
    const absPath = join(harness.courseFolder, '성적.xlsx')
    await writeXlsx(absPath)

    const result = await harness.tools.call('edit_sheet', {
      courseId: harness.courseId,
      relPath: '성적.xlsx',
      sheet: '없는시트',
      edits: [{ cell: 'A1', value: 1 }]
    })

    expect(result.isError).toBe(true)
    expect(message(result)).toContain('«없는시트»')
    expect(message(result)).toContain('«성적»')
  })

  test('rejects .xls with a conversion hint and never touches the file', async () => {
    writeFileSync(join(harness.courseFolder, '옛날.xls'), Buffer.from([9, 9]))

    const result = await harness.tools.call('edit_sheet', {
      courseId: harness.courseId,
      relPath: '옛날.xls',
      edits: [{ cell: 'A1', value: 1 }]
    })

    expect(result.isError).toBe(true)
    expect(message(result)).toContain('.xlsx')
    expect(message(result)).toContain('변환')
  })

  test('rejects calls with neither edits nor appendRows', async () => {
    const result = await harness.tools.call('edit_sheet', {
      courseId: harness.courseId,
      relPath: '성적.xlsx'
    })

    expect(result.isError).toBe(true)
    expect(message(result)).toContain('적어도 하나')
  })

  test('rejects malformed cell addresses before touching the file', async () => {
    const result = await harness.tools.call('edit_sheet', {
      courseId: harness.courseId,
      relPath: '성적.xlsx',
      edits: [{ cell: '2B', value: 1 }]
    })

    expect(result.isError).toBe(true)
    expect(message(result)).toContain('A1-style')
  })

  test('denied confirmation writes nothing and makes no backup', async () => {
    const absPath = join(harness.courseFolder, '성적.xlsx')
    await writeXlsx(absPath)
    const original = readFileSync(absPath)
    harness.deps.confirm = async () => false

    const result = await harness.tools.call('edit_sheet', {
      courseId: harness.courseId,
      relPath: '성적.xlsx',
      edits: [{ cell: 'B2', value: 0 }]
    })

    expect(result.isError).toBeUndefined()
    expect(payload(result)).toMatchObject({ cancelled: true })
    expect(readFileSync(absPath)).toEqual(original)
    expect(existsSync(join(harness.courseFolder, '.bandal', 'backups'))).toBe(false)
    expect(harness.journal.forTurn('turn-1').actions).toHaveLength(0)
  })

  test('undo restores the exact original bytes', async () => {
    const absPath = join(harness.courseFolder, '성적.xlsx')
    await writeXlsx(absPath)
    const original = readFileSync(absPath)

    const result = await harness.tools.call('edit_sheet', {
      courseId: harness.courseId,
      relPath: '성적.xlsx',
      edits: [{ cell: 'B2', value: 0 }]
    })
    expect(result.isError).toBeUndefined()
    expect(readFileSync(absPath)).not.toEqual(original)

    expect(
      await harness.journal.undoTurn('turn-1', undoHandlersFor(harness))
    ).toEqual({
      undone: 1,
      results: [{ actionId: expect.any(String), ok: true }]
    })
    expect(readFileSync(absPath)).toEqual(original)
  })
})

describe('edit_docx_text', () => {
  let harness: Harness

  beforeEach(() => {
    harness = makeHarness()
  })

  afterEach(() => {
    harness.ctx.cleanup()
  })

  test('replaces every occurrence with per-item counts under scope all', async () => {
    const absPath = join(harness.courseFolder, '과제.docx')
    await writeDocx(absPath)

    const result = await harness.tools.call('edit_docx_text', {
      courseId: harness.courseId,
      relPath: '과제.docx',
      replacements: [
        { find: '기한', replace: '마감' },
        { find: '90점', replace: '95점' }
      ]
    })

    expect(result.isError).toBeUndefined()
    expect(payload(result)).toMatchObject({
      totalReplacements: 3,
      replaced: [
        { find: '기한', count: 2 },
        { find: '90점', count: 1 }
      ]
    })

    const xml = await readDocumentXml(absPath)
    expect(xml).toContain('마감: 8월 18일. 마감 엄수.')
    expect(xml).toContain('95점')
    expect(xml).not.toContain('기한')
    // run 서식(w:rPr)은 그대로 남아야 한다.
    expect(xml).toContain('<w:rPr><w:b/></w:rPr>')
    expect(xml).toContain('xml:space="preserve"')

    const actions = harness.journal.forTurn('turn-1').actions
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      tool: 'edit_docx_text',
      targetKind: 'material-edit',
      undoable: true
    })
  })

  test('scope first replaces only the first occurrence per item', async () => {
    const absPath = join(harness.courseFolder, '과제.docx')
    await writeDocx(absPath)

    const result = await harness.tools.call('edit_docx_text', {
      courseId: harness.courseId,
      relPath: '과제.docx',
      scope: 'first',
      replacements: [{ find: '기한', replace: '마감' }]
    })

    expect(payload(result)).toMatchObject({
      totalReplacements: 1,
      replaced: [{ find: '기한', count: 1 }]
    })
    const xml = await readDocumentXml(absPath)
    expect(xml).toContain('마감: 8월 18일. 기한 엄수.')
  })

  test('matches decoded entities and re-encodes the replacement', async () => {
    const absPath = join(harness.courseFolder, '과제.docx')
    await writeDocx(absPath)

    const result = await harness.tools.call('edit_docx_text', {
      courseId: harness.courseId,
      relPath: '과제.docx',
      replacements: [{ find: '90점 & 보너스', replace: '95점 & 가산점' }]
    })

    expect(payload(result)).toMatchObject({ totalReplacements: 1 })
    const xml = await readDocumentXml(absPath)
    expect(xml).toContain('95점 &amp; 가산점')
    expect(xml).not.toContain('점 & 가산점')
  })

  test('zero matches writes nothing, makes no backup and explains itself', async () => {
    const absPath = join(harness.courseFolder, '과제.docx')
    await writeDocx(absPath)
    const original = readFileSync(absPath)
    const confirms: string[] = []
    harness.deps.confirm = async (request) => {
      confirms.push(request.tool)
      return true
    }

    const result = await harness.tools.call('edit_docx_text', {
      courseId: harness.courseId,
      relPath: '과제.docx',
      replacements: [{ find: '문서에 없는 문구', replace: '무엇이든' }]
    })

    expect(result.isError).toBeUndefined()
    expect(payload(result)).toMatchObject({
      totalReplacements: 0,
      replaced: [{ find: '문서에 없는 문구', count: 0 }]
    })
    expect(message(result)).toContain('일치하는 텍스트')
    // 바꿀 것이 없으면 확인 대화상자도 띄우지 않는다.
    expect(confirms).toHaveLength(0)
    expect(readFileSync(absPath)).toEqual(original)
    expect(existsSync(join(harness.courseFolder, '.bandal', 'backups'))).toBe(false)
    expect(harness.journal.forTurn('turn-1').actions).toHaveLength(0)
  })

  test('denied confirmation writes nothing and makes no backup', async () => {
    const absPath = join(harness.courseFolder, '과제.docx')
    await writeDocx(absPath)
    const original = readFileSync(absPath)
    harness.deps.confirm = async () => false

    const result = await harness.tools.call('edit_docx_text', {
      courseId: harness.courseId,
      relPath: '과제.docx',
      replacements: [{ find: '기한', replace: '마감' }]
    })

    expect(payload(result)).toMatchObject({ cancelled: true })
    expect(readFileSync(absPath)).toEqual(original)
    expect(existsSync(join(harness.courseFolder, '.bandal', 'backups'))).toBe(false)
    expect(harness.journal.forTurn('turn-1').actions).toHaveLength(0)
  })

  test('rejects non-docx files', async () => {
    const result = await harness.tools.call('edit_docx_text', {
      courseId: harness.courseId,
      relPath: '필기.md',
      replacements: [{ find: 'a', replace: 'b' }]
    })

    expect(result.isError).toBe(true)
    expect(message(result)).toContain('.docx')
  })

  test('undo restores the exact original bytes', async () => {
    const absPath = join(harness.courseFolder, '과제.docx')
    await writeDocx(absPath)
    const original = readFileSync(absPath)

    const result = await harness.tools.call('edit_docx_text', {
      courseId: harness.courseId,
      relPath: '과제.docx',
      replacements: [{ find: '기한', replace: '마감' }]
    })
    expect(result.isError).toBeUndefined()
    expect(readFileSync(absPath)).not.toEqual(original)

    expect(
      await harness.journal.undoTurn('turn-1', undoHandlersFor(harness))
    ).toEqual({
      undone: 1,
      results: [{ actionId: expect.any(String), ok: true }]
    })
    expect(readFileSync(absPath)).toEqual(original)
  })
})
