import { pinPdfClipSources } from './pdfClipSource'
import { archivePdfRows } from './noteDataArchive'
import { PDFDocument, PDFHexString, degrees } from 'pdf-lib'
import { createHash, randomUUID } from 'node:crypto'
import { ValidationError } from '../../db/errors'
import { requireId, requireNonEmptyString, resolveInsideReal } from '../../db/validate'
import { parsePdfPageNote, serializePdfPageNote, type PdfPageNoteDocument, type PdfPageSize } from '../../../shared/pdfPageNote'
import { isPdfPageNoteLinkMetadata, type MaterialLinkRecord } from '../../../shared/types/link'
import { transformBox, transformShape } from './noteGeometry'
import { createNoteFileTransaction, type NoteFileWrite } from './noteFileTransaction'
import { createLegacyNoteMigration } from './legacyNoteMigration'
import { join } from 'node:path'
import type { CreatePdfNoteInput, RestructurePdfInput, RestructurePdfResult, PdfNoteInfo } from '../../../shared/types/pdfNote'
import { readFile } from 'node:fs/promises'
import { PAPERS, drawPaper, noteSize, readPaper, readSurface, setPaper, type Orientation, type Paper } from './notePaper'

export interface PdfNotesDeps { db: any; courses: { getFolder(courseId: string): string }; materials: any; notes: any; links: any; pdfBindings: any; userDataPath: string; changed: (courseId: string) => void }
/** One entry per page of the new document: an existing page (1-based) with an
 * extra rotation, or `null` for a new blank page. Reorder, delete, duplicate,
 * rotate and insert are all expressed by this one recipe. */
export interface PageRecipeEntry { source: number | null; rotate?: 0 | 90 | 180 | 270 }
interface Geometry { rotation: number; width: number; height: number }

const normalizeRotation = (angle: number) => ((Math.round(angle) % 360) + 360) % 360
function relativePath(value: unknown): string {
  const path = requireNonEmptyString(value, 'relPath')
  if (path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '..' || part === '.') || /[\u0000-\u001f]/.test(path)) throw new ValidationError('Invalid PDF relative path')
  return path
}
function recipe(value: unknown, pageCount: number): PageRecipeEntry[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2000) throw new ValidationError('pages must list 1 to 2000 entries')
  return value.map(entry => {
    if (!entry || typeof entry !== 'object') throw new ValidationError('Invalid page entry')
    const { source, rotate } = entry as { source?: unknown; rotate?: unknown }
    if (source !== null && (!Number.isInteger(source) || (source as number) < 1 || (source as number) > pageCount)) throw new ValidationError('page source is out of range')
    if (rotate !== undefined && ![0, 90, 180, 270].includes(rotate as number)) throw new ValidationError('rotate must be 0, 90, 180 or 270')
    return { source: source as number | null, rotate: (rotate ?? 0) as 0 | 90 | 180 | 270 }
  })
}
/** A fresh /ID so pdf.js reports a new, deterministic fingerprint for the
 * rewritten bytes (page-note links are keyed by that fingerprint). */
function stampIdentity(pdf: PDFDocument): string {
  const fingerprint = randomUUID().replace(/-/g, '')
  pdf.context.trailerInfo.ID = pdf.context.obj([PDFHexString.of(fingerprint), PDFHexString.of(fingerprint)])
  return fingerprint
}
const displayed = (g: Geometry): PdfPageSize => g.rotation === 90 || g.rotation === 270 ? { width: g.height, height: g.width } : { width: g.width, height: g.height }

export function createPdfNotesService(deps: PdfNotesDeps) {
  const { db } = deps
  const publish = createNoteFileTransaction(db, join(deps.userDataPath, 'NoteRecovery'))
  const legacy = createLegacyNoteMigration(deps, publish)
  db.exec(`CREATE TABLE IF NOT EXISTS pdf_restructure_log (
    id TEXT PRIMARY KEY, material_id TEXT NOT NULL, from_sha TEXT NOT NULL, to_sha TEXT NOT NULL, recipe_json TEXT NOT NULL, created_at TEXT NOT NULL
  )`)
  const copyRow = (table: string, row: Record<string, unknown>, overrides: Record<string, unknown>): void => {
    const next = { ...row, ...overrides }, columns = Object.keys(next)
    db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map(column => next[column]))
  }

  const restructure = async (request: RestructurePdfInput): Promise<RestructurePdfResult> => {
    publish.recover()
    const courseId = requireId(request.courseId, 'courseId'), relPath = relativePath(request.relPath)
    const expected = request.expectedRevision
    if (typeof expected !== 'string' || !/^[0-9a-f]{64}$/.test(expected)) throw new ValidationError('expectedRevision must be a SHA-256 digest')
    // Verifies bound_sha == current file == the revision the viewer showed, and
    // keeps the previous bytes under PDFOriginals/<sha>.pdf.
    const binding = deps.pdfBindings.check({ courseId, relPath, documentRevision: expected })
    const path = resolveInsideReal(deps.courses.getFolder(courseId), relPath)
    const sourceBytes = await readFile(path)
    const source = await PDFDocument.load(sourceBytes)
    const sourcePages = source.getPages(), count = sourcePages.length
    // Array.from keeps the recipe in this realm: a host-supplied array fails pdf-lib's instanceof checks.
    const entries = Array.from(recipe(request.pages, count))
    const geometry = sourcePages.map((page): Geometry => {
      const crop = page.getCropBox(), rotation = normalizeRotation(page.getRotation().angle)
      if (![0, 90, 180, 270].includes(rotation)) throw new ValidationError('PDF page rotation is unsupported')
      return { rotation, width: crop.width, height: crop.height }
    })
    const output = await PDFDocument.create()
    const paper = readPaper(source), surface = readSurface(source)
    if (paper) setPaper(output, paper, geometry[0] && geometry[0].width > geometry[0].height ? 'landscape' : 'portrait', surface)
    if (source.getTitle()) output.setTitle(source.getTitle()!)
    const copied = await output.copyPages(source, Array.from(entries.flatMap(entry => entry.source === null ? [] : [entry.source - 1])))
    let copyIndex = 0
    const next: Geometry[] = []
    entries.forEach((entry, index) => {
      if (entry.source !== null) {
        const page = copied[copyIndex++]!, old = geometry[entry.source - 1]!
        const rotation = normalizeRotation(old.rotation + (entry.rotate ?? 0))
        page.setRotation(degrees(rotation))
        output.addPage(page)
        next.push({ ...old, rotation })
        return
      }
      // A blank page matches its nearest neighbour's displayed size.
      const neighbour = [...entries.slice(0, index).reverse(), ...entries.slice(index + 1)].find(item => item.source !== null)
      const size = neighbour ? displayed({ ...geometry[neighbour.source! - 1]!, rotation: normalizeRotation(geometry[neighbour.source! - 1]!.rotation + (neighbour.rotate ?? 0)) }) : { width: noteSize('portrait')[0], height: noteSize('portrait')[1] }
      const page = output.addPage([size.width, size.height])
      if (paper) drawPaper(page, paper, surface)
      next.push({ rotation: 0, width: size.width, height: size.height })
    })
    const fingerprint = stampIdentity(output)
    const bytes = await output.save(), revision = createHash('sha256').update(Buffer.from(bytes)).digest('hex')
    const targets = new Map<number, number[]>()
    entries.forEach((entry, index) => { if (entry.source !== null) targets.set(entry.source, [...(targets.get(entry.source) ?? []), index + 1]) })
    const now = new Date().toISOString()
    const remapTable = (table: 'pdf_drawings' | 'annotations', transform: (row: any, oldGeometry: Geometry, newGeometry: Geometry) => Record<string, unknown>) => {
      const rows = db.prepare(`SELECT * FROM ${table} WHERE course_id=? AND rel_path=?`).all(courseId, relPath)
      for (const row of rows) {
        const places = targets.get(row.page) ?? []
        if (!places.length) { db.prepare(`UPDATE ${table} SET deleted_at=COALESCE(deleted_at,?), updated_at=?, page=? WHERE id=?`).run(now, now, Math.min(row.page, entries.length), row.id); continue }
        const oldGeometry = geometry[row.page - 1]
        if (!oldGeometry) throw new ValidationError('PDF 필기의 기존 페이지를 확인해 주세요.')
        places.forEach((page, order) => {
          const changes: Record<string, unknown> = { ...transform(row, oldGeometry, next[page - 1]!), page, updated_at: now }
          if (order === 0) {
            const keys = Object.keys(changes)
            db.prepare(`UPDATE ${table} SET ${keys.map(key => `${key}=?`).join(',')} WHERE id=?`).run(...keys.map(key => changes[key]), row.id)
          } else copyRow(table, row, { ...changes, id: randomUUID(), created_at: now })
        })
      }
    }
    const writes: NoteFileWrite[] = [{ target: path, bytes: Buffer.from(bytes) }]
    const pageNoteUpdates: Array<() => void> = []
    const pageLinks = (): MaterialLinkRecord[] => deps.links.listFor(courseId, relPath).outgoing.filter((link: MaterialLinkRecord) => link.kind === 'pdf-page-note')
    const linkedNotes = pageLinks()
    const linkSnapshot = (links: MaterialLinkRecord[]): string => JSON.stringify(links.map(({ id, target, metadata }) => ({ id, target, metadata })).sort((a, b) => a.id.localeCompare(b.id)))
    const expectedLinks = linkSnapshot(linkedNotes)
    const assertLinksCurrent = (): void => {
      if (linkSnapshot(pageLinks()) !== expectedLinks) throw new ValidationError('페이지 변경을 기다리는 동안 연결된 노트가 변경되었습니다. 페이지 변경을 다시 시도해 주세요.')
    }
    // Prepare linked Markdown before the transaction; it is journaled with the PDF.
    for (const link of linkedNotes) {
      if (link.kind !== 'pdf-page-note' || link.target.kind !== 'note' || !isPdfPageNoteLinkMetadata(link.metadata)) continue
      let note: { markdown: string; mtime: number }
      try { note = deps.notes.read(link.target.payload) } catch { continue }
      const document = parsePdfPageNote(note.markdown)
      if (!document) continue
      const kept = new Set(entries.map(entry => entry.source))
      const removed = document.pages.map((content, index) => ({ page: index + 1, content: content.trim() })).filter(({ page, content }) => !kept.has(page) && content.length > 0)
      const archived = removed.length ? ['## 연결 제외된 페이지', '', ...removed.flatMap(({ page, content }) => [`### 기존 PDF ${page}쪽`, '', content, ''])].join('\n').trim() : ''
      const rewritten: PdfPageNoteDocument = { title: document.title, manifest: { version: 1, source: document.manifest.source, fingerprint, pages: next.map(displayed) }, pages: entries.map(entry => entry.source === null ? '' : document.pages[entry.source - 1] ?? ''), appendix: [document.appendix, archived].filter(Boolean).join('\n\n') }
      const latest = deps.notes.read(link.target.payload)
      if (latest.mtime !== note.mtime || latest.markdown !== note.markdown) throw new ValidationError('연결된 마크다운이 변경되었습니다. 페이지 변경을 다시 시도해 주세요.')
      writes.push({ target: resolveInsideReal(deps.courses.getFolder(courseId), link.target.payload.relPath), bytes: Buffer.from(serializePdfPageNote(rewritten)) })
      const syncScroll = link.metadata.syncScroll
      pageNoteUpdates.push(() => deps.links.updateMetadata(courseId, link.id, { version: 1, syncScroll, fingerprint, pageSizes: next.map(displayed) }))
    }
    // Recheck after asynchronous PDF generation: never overwrite intervening edits.
    deps.pdfBindings.check({ courseId, relPath, documentRevision: expected })
    await publish.publishAsync(writes, () => {
      // Link mutations do not take the material lock. Validate again in this
      // synchronous transaction if one arrived after the retry preflight.
      assertLinksCurrent()
      pinPdfClipSources(db,courseId,relPath,expected,sourceBytes.length)
      archivePdfRows(db, binding.materialID, expected, courseId, relPath)
      db.prepare('UPDATE pdf_document_bindings SET bound_sha=?, evidence=?, legacy_unverified=0 WHERE material_id=?').run(revision, 'receipt', binding.materialID)
      db.prepare('INSERT INTO pdf_restructure_log(id,material_id,from_sha,to_sha,recipe_json,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(), binding.materialID, expected, revision, JSON.stringify(entries), now)
      remapTable('pdf_drawings', (row, oldGeometry, newGeometry) => {
        if (oldGeometry.rotation === newGeometry.rotation) return {}
        const shape = transformShape(transformShape({ data: JSON.parse(row.data_json), style: JSON.parse(row.style_json) }, oldGeometry), newGeometry, true)
        return { data_json: JSON.stringify(shape.data), style_json: JSON.stringify(shape.style) }
      })
      remapTable('annotations', (row, oldGeometry, newGeometry) => {
        if (oldGeometry.rotation === newGeometry.rotation) return {}
        const rects = (JSON.parse(row.rects_json) as any[]).map(rect => transformBox(transformBox(rect, oldGeometry.rotation), newGeometry.rotation, true))
        return { rects_json: JSON.stringify(rects) }
      })
      const view = db.prepare('SELECT page FROM pdf_view_state WHERE course_id=? AND rel_path=?').get(courseId, relPath)
      if (view) db.prepare('UPDATE pdf_view_state SET page=?, updated_at=? WHERE course_id=? AND rel_path=?').run(targets.get(view.page)?.[0] ?? Math.min(view.page, entries.length), now, courseId, relPath)
      for (const row of db.prepare('SELECT a.id, a.payload FROM recording_anchors a JOIN recording_sessions s ON s.id=a.session_id WHERE s.course_id=?').all(courseId)) {
        const anchor = JSON.parse(row.payload)
        if (anchor.relPath !== relPath || typeof anchor.page !== 'number') continue
        const page = targets.get(anchor.page)?.[0] ?? Math.min(anchor.page, entries.length)
        if (page !== anchor.page) db.prepare('UPDATE recording_anchors SET payload=? WHERE id=?').run(JSON.stringify({ ...anchor, page }), row.id)
      }
      for (const update of pageNoteUpdates) update()
    }, { beforeAttempt: assertLinksCurrent })
    deps.pdfBindings.check({ courseId, relPath, documentRevision: revision })
    deps.materials.invalidateTree(courseId); deps.changed(courseId)
    return { documentRevision: revision, fingerprint, pageCount: entries.length, pageMap: Array.from({ length: count }, (_, index) => targets.get(index + 1) ?? []) }
  }

  const NOTES_FOLDER = '노트'
  const create = async (request: CreatePdfNoteInput): Promise<{ relPath: string }> => {
    publish.recover()
    const courseId = requireId(request.courseId, 'courseId')
    const paper = (request.paper ?? 'lines') as Paper, orientation = (request.orientation ?? 'portrait') as Orientation
    if (!PAPERS.includes(paper)) throw new ValidationError('paper must be blank, lines, grid or dots')
    if (orientation !== 'portrait' && orientation !== 'landscape') throw new ValidationError('orientation must be portrait or landscape')
    const title = (typeof request.title === 'string' ? request.title : '').replace(/[/\\:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 120) || '노트'
    // Notes collect in one folder so the sidebar can list and manage them.
    const dirRelPath = request.dirRelPath === undefined ? NOTES_FOLDER : request.dirRelPath === '' ? '' : relativePath(request.dirRelPath)
    const pdf = await PDFDocument.create()
    pdf.setTitle(title); pdf.setCreator('Bandal'); setPaper(pdf, paper, orientation)
    drawPaper(pdf.addPage(noteSize(orientation)), paper)
    stampIdentity(pdf)
    const bytes = await pdf.save()
    const result = deps.materials.writeFile({ courseId, dirRelPath, fileName: `${title}.pdf`, encoding: 'base64', data: Buffer.from(bytes).toString('base64'), createDirIfMissing: true })
    deps.changed(courseId)
    return result
  }
  return { create, restructure, migrateLegacy: (request: { courseId?: string } = {}) => { publish.recover(); return legacy.migrate(request) }, migrationStatus: legacy.status,
    async info(request: { courseId: string; relPath: string }): Promise<PdfNoteInfo> {
      const bytes = await readFile(resolveInsideReal(deps.courses.getFolder(requireId(request.courseId, 'courseId')), relativePath(request.relPath)))
      const pdf = await PDFDocument.load(bytes)
      const first = pdf.getPages()[0]
      const size = first ? displayed({ width:first.getWidth(),height:first.getHeight(),rotation:normalizeRotation(first.getRotation().angle) }) : undefined
      return { documentRevision: createHash('sha256').update(bytes).digest('hex'), paper: readPaper(pdf), surface: readSurface(pdf), orientation: size && size.width > size.height ? 'landscape' : 'portrait' }
    }
  }
}
