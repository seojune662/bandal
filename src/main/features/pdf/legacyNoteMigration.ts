import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { PDFDocument, PDFHexString } from 'pdf-lib'
import { requireId, resolveInsideReal } from '../../db/validate'
import { ValidationError } from '../../db/errors'
import { assertDrawingData, assertDrawingKind, assertDrawingStyle } from '../drawingValidation'
import { drawPaper, noteSize, setPaper, type Paper, type NoteSurface } from './notePaper'
import type { PdfNotesDeps } from './pdfNotes'
import type { NoteFileWrite } from './noteFileTransaction'
import type { LegacyNoteMapping, LegacyNoteMigrationResult } from '../../../shared/types/pdfNote'

export const LEGACY_NOTE_MIGRATION_VERSION = 1
export const canonicalNoteJSON = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
export const noteDigest = (value: unknown): string => createHash('sha256').update(canonicalNoteJSON(value)).digest('hex')
export function legacyNoteID(boardId: string, suffix = 'material'): string {
  const hash = noteDigest({ version: LEGACY_NOTE_MIGRATION_VERSION, boardId, suffix })
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`
}
export function installNoteMigrationSchema(db: any): void {
  db.exec(`CREATE TABLE IF NOT EXISTS pdf_note_migrations (
    source_board_id TEXT PRIMARY KEY, target_material_id TEXT NOT NULL UNIQUE,
    course_id TEXT NOT NULL, rel_path TEXT NOT NULL, version INTEGER NOT NULL,
    source_revision TEXT NOT NULL, original_json TEXT, created_at TEXT NOT NULL
  )`)
}
export function legacyBoardSnapshot(db: any, boardId: string): any {
  const board = db.prepare('SELECT * FROM whiteboards WHERE id=? AND deleted_at IS NULL').get(boardId)
  if (!board) throw new ValidationError('이전 노트를 찾을 수 없습니다.')
  return { board, shapes: db.prepare('SELECT * FROM whiteboard_local_shapes WHERE board_id=? ORDER BY created_at,id').all(boardId) }
}
export function legacyBoardRevision(snapshot: any): string {
  const b = snapshot.board
  return noteDigest({ board: { id: b.id, courseId: b.course_id, title: b.title, background: b.background, surface: b.surface, pages: b.page_count }, shapes: [...snapshot.shapes].sort((a:any,b:any)=>a.id.localeCompare(b.id)).map((s: any) => ({ id: s.id, kind: s.kind, page: s.page, data: JSON.parse(s.data_json), style: JSON.parse(s.style_json), deleted: !!s.deleted_at })) })
}
export function createLegacyNoteMigration(deps: PdfNotesDeps, publish: (writes: NoteFileWrite[], commit: () => void) => void) {
  const { db } = deps
  installNoteMigrationSchema(db)
  const mapping = (row: any): LegacyNoteMapping => ({ boardId: row.source_board_id, materialId: row.target_material_id, relPath: row.rel_path, sourceRevision: row.source_revision })
  const status = (request: { courseId?: string } = {}): LegacyNoteMapping[] => {
    if (request.courseId !== undefined) requireId(request.courseId, 'courseId')
    return db.prepare(`SELECT m.*, COALESCE(a.rel_path,m.rel_path) AS rel_path FROM pdf_note_migrations m LEFT JOIN pdf_document_aliases a ON a.material_id=m.target_material_id ${request.courseId ? 'WHERE m.course_id=?' : ''} ORDER BY m.created_at,m.source_board_id`).all(...(request.courseId ? [request.courseId] : [])).map(mapping)
  }
  async function migrateOne(boardId: string): Promise<LegacyNoteMapping> {
    const old = db.prepare('SELECT * FROM pdf_note_migrations WHERE source_board_id=?').get(boardId)
    if (old) return status({ courseId: old.course_id }).find(row => row.boardId === boardId)!
    const original = legacyBoardSnapshot(db, boardId), { board, shapes } = original
    const sourceRevision = legacyBoardRevision(original), materialId = legacyNoteID(boardId)
    const pageCount = board.page_count ?? 1
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 2000) throw new ValidationError('이전 노트의 페이지 수를 확인해 주세요.')
    // Validate every editable object before publishing any part of the conversion.
    for (const row of shapes) {
      assertDrawingKind(row.kind); assertDrawingData(JSON.parse(row.data_json), row.kind, { allowClip: true }); assertDrawingStyle(JSON.parse(row.style_json))
      if (!Number.isInteger(row.page) || row.page < 1 || (row.page > pageCount && !row.deleted_at)) throw new ValidationError('이전 노트의 필기 페이지를 확인해 주세요.')
    }
    const paper = board.background as Paper, surface = board.surface as NoteSurface
    if (!['blank','lines','grid','dots'].includes(paper) || !['dark','light'].includes(surface)) throw new ValidationError('이전 노트의 종이 설정을 확인해 주세요.')
    const title = String(board.title).replace(/[/\\:*?"<>|\u0000-\u001f]/g, '').trim().slice(0,100) || '노트'
    const relPath = `노트/${title} (${materialId}).pdf`, path = resolveInsideReal(deps.courses.getFolder(board.course_id), relPath)
    if (existsSync(path) || db.prepare('SELECT id FROM materials_index WHERE id=? OR (course_id=? AND rel_path=?)').get(materialId, board.course_id, relPath)) throw new ValidationError('변환된 노트의 저장 위치가 이미 사용 중입니다. 기존 파일을 보존했습니다.')
    const pdf = await PDFDocument.create()
    pdf.setTitle(board.title); pdf.setCreator('Bandal'); pdf.setProducer('Bandal PDF notes v1')
    // Same source creates byte-identical paper on desktop and iPad, even offline.
    const date = new Date('2000-01-01T00:00:00.000Z')
    pdf.setCreationDate(date); pdf.setModificationDate(date); setPaper(pdf, paper, 'portrait', surface)
    const fingerprint = noteDigest({ boardId, paper, surface, pageCount, version: 1 }).slice(0,32)
    pdf.context.trailerInfo.ID = pdf.context.obj([PDFHexString.of(fingerprint), PDFHexString.of(fingerprint)])
    for (let page = 0; page < pageCount; page++) drawPaper(pdf.addPage(noteSize('portrait')), paper, surface)
    const bytes = Buffer.from(await pdf.save()), revision = createHash('sha256').update(bytes).digest('hex')
    if (legacyBoardRevision(legacyBoardSnapshot(db, boardId)) !== sourceRevision) throw new ValidationError('변환하는 동안 이전 노트가 변경되었습니다. 다시 시도해 주세요.')
    const preparedShapes=shapes.map((row:any)=>{
      if(row.kind!=='clip')return row
      const data=JSON.parse(row.data_json),clip=data.clip
      if(!clip||clip.documentRevision)return row
      const clipPath=resolveInsideReal(deps.courses.getFolder(board.course_id),clip.relPath)
      // A historically missing source remains visibly missing; never invent
      // bytes. Every available source is pinned before the migrated note opens.
      if(!existsSync(clipPath))return row
      const binding=deps.pdfBindings.check({courseId:board.course_id,relPath:clip.relPath})
      return{...row,data_json:JSON.stringify({...data,clip:{...clip,materialID:binding.materialID,documentRevision:binding.documentRevision,documentByteCount:statSync(clipPath).size}})}
    })
    const now = new Date().toISOString()
    publish([{ target: path, bytes }], () => {
      // Never replace existing PDFs, original boards or original shape identities.
      db.prepare('INSERT INTO materials_index(id,course_id,rel_path,kind,size,mtime,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(materialId,board.course_id,relPath,'pdf',bytes.length,statSync(path).mtimeMs,board.created_at,now)
      db.prepare('INSERT INTO pdf_document_bindings(material_id,bound_sha,evidence,legacy_unverified,created_at) VALUES(?,?,?,?,?)').run(materialId,revision,'receipt',0,now)
      db.prepare('INSERT INTO pdf_document_aliases(course_id,rel_path,material_id) VALUES(?,?,?)').run(board.course_id,relPath,materialId)
      for (const row of preparedShapes.filter((row:any)=>row.page<=pageCount)) db.prepare('INSERT INTO pdf_drawings(id,course_id,rel_path,page,kind,data_json,style_json,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(legacyNoteID(boardId,`shape:${row.id}`),board.course_id,relPath,row.page,row.kind,row.data_json,row.style_json,row.created_at,row.updated_at,row.deleted_at ?? null)
      db.prepare('INSERT INTO pdf_note_migrations(source_board_id,target_material_id,course_id,rel_path,version,source_revision,original_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(boardId,materialId,board.course_id,relPath,1,sourceRevision,canonicalNoteJSON(original),now)
    })
    // Detect accidental filesystem damage before reporting a completed conversion.
    if (createHash('sha256').update(readFileSync(path)).digest('hex') !== revision) throw new Error('변환된 노트의 무결성을 확인하지 못했습니다. 원본은 보존되어 있습니다.')
    deps.materials.recordAdded(board.course_id,relPath); deps.materials.invalidateTree(board.course_id); deps.changed(board.course_id)
    return { boardId, materialId, relPath, sourceRevision }
  }
  return { status, async migrate(request: { courseId?: string } = {}): Promise<LegacyNoteMigrationResult> {
    if (request.courseId !== undefined) requireId(request.courseId,'courseId')
    const rows = db.prepare(`SELECT id FROM whiteboards WHERE deleted_at IS NULL ${request.courseId ? 'AND course_id=?' : ''} ORDER BY created_at,id`).all(...(request.courseId ? [request.courseId] : []))
    const result: LegacyNoteMigrationResult = { migrated: [], failed: [] }
    for (const row of rows) try { result.migrated.push(await migrateOne(row.id)) } catch (error) { result.failed.push({boardId:row.id,message:error instanceof Error ? error.message : String(error)}) }
    return result
  } }
}
