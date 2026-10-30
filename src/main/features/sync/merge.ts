/**
 * Pure merge of a parsed cloud root (spec v2.1 "머지"). The result depends
 * only on the set of files, never on their order or on reading one twice.
 */
import { v5 as uuidv5 } from 'uuid'
import { SYNC_FORMAT, type InkObject, type ParsedFile } from './format'

export const CONFLICT_COPY_NAMESPACE = '9b1f6a2e-3c4d-4e5f-8a6b-7c8d9e0f1a2b'

export interface Register<T = unknown> {
  value: T
  t: number
  device: string
  /** File seq and position in that file's array: they settle a same-stamp tie. */
  seq: number
  index: number
}

export interface Entity {
  fields: Map<string, Register>
  /** `*.delete` writes true and `*.upsert` writes false, both under the same order. */
  deleted: Register<boolean> | null
}

export interface ConflictCopy {
  id: string
  of: string
  course_id: string
  rel_path: string
  name: string
  md_hash: string
  /** Root path of the losing version's content. */
  file: string
}

export interface MergedState {
  /** Set when `bandal.json` is missing or not format 2: nothing else is read. */
  blocked: 'missing-root' | 'update-required' | 'unsupported-format' | null
  devices: Map<string, string>
  courses: Map<string, Entity>
  docs: Map<string, Entity>
  /** Winning version per drawing id, with the document its file sits under. */
  ink: Map<string, Register<{ doc: string; object: InkObject }>>
  /** md body per document: the md_hash winner and the file holding it. */
  notes: Map<string, { hash: string; file: string | null }>
  conflictCopies: ConflictCopy[]
  /** `doc.upsert` renames that settle path collisions; every device computes the same list. */
  renames: { id: string; name: string }[]
  /** Not appliable yet: a referenced course, document, PDF, asset or note file is missing. */
  waiting: { docs: string[]; ink: string[]; copies: string[] }
}

interface NoteVersion {
  hash: string
  base: string | null
  t: number
  device: string
  seq: number
  index: number
}

type NoteFile = Extract<ParsedFile, { kind: 'note' }>

/**
 * Larger t, then larger device_id. A same-stamp tie only comes from a writer
 * breaking the spec; the later write wins: larger file seq, then later in the file.
 */
function beats(next: Register, current: Register | null | undefined): boolean {
  if (!current) return true
  if (next.t !== current.t) return next.t > current.t
  if (next.device !== current.device) return next.device > current.device
  if (next.seq !== current.seq) return next.seq > current.seq
  return next.index > current.index
}

export const isAlive = (entity: Entity | undefined): boolean => entity !== undefined && entity.deleted?.value !== true

function splitName(name: string): [stem: string, ext: string] {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
}

function push<K, V>(map: Map<K, V[]>, key: K, item: V): void {
  const list = map.get(key)
  if (list) list.push(item)
  else map.set(key, [item])
}

/** Device names are user text; keep the copy's name one valid path segment. */
const nameSafe = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f/]/g, '_')

/** Path-collision key: NFC folder and name compared without case, as APFS and NTFS do. */
const pathKey = (course: string, folder: string, name: string): string => JSON.stringify([course, folder.toLowerCase(), name.toLowerCase()])

function emptyState(blocked: MergedState['blocked']): MergedState {
  return {
    blocked, devices: new Map(), courses: new Map(), docs: new Map(), ink: new Map(), notes: new Map(),
    conflictCopies: [], renames: [], waiting: { docs: [], ink: [], copies: [] }
  }
}

export function merge(files: readonly ParsedFile[]): MergedState {
  const root = files.find(file => file.kind === 'root')
  if (!root) return emptyState('missing-root')
  if (root.format !== SYNC_FORMAT) return emptyState(root.format > SYNC_FORMAT ? 'update-required' : 'unsupported-format')

  const state = emptyState(null), waitingDocs = new Set<string>()
  const copies: (Omit<ConflictCopy, 'file'> & { file: string | null })[] = []
  const present = new Set<string>(), versions = new Map<string, NoteVersion[]>(), noteFiles = new Map<string, NoteFile[]>()

  for (const file of files) {
    if (file.kind === 'device') state.devices.set(file.device, file.name)
    else if (file.kind === 'pdf' || file.kind === 'asset') present.add(file.path)
    else if (file.kind === 'note') push(noteFiles, file.doc, file)
    else if (file.kind === 'ink') {
      file.objects.forEach((object, index) => {
        const version = { value: { doc: file.doc, object }, t: object.t, device: file.author, seq: file.seq, index }
        if (beats(version, state.ink.get(object.id))) state.ink.set(object.id, version)
      })
    } else if (file.kind === 'log') {
      file.events.forEach((event, index) => {
        const entities = event.op.startsWith('course.') ? state.courses : state.docs
        const entity = entities.get(event.id) ?? { fields: new Map<string, Register>(), deleted: null }
        entities.set(event.id, entity)
        const stamp = { t: event.t, device: file.author, seq: file.seq, index }
        const deleted = { ...stamp, value: event.op.endsWith('.delete') }
        if (beats(deleted, entity.deleted)) entity.deleted = deleted
        if (deleted.value) return
        for (const [key, value] of Object.entries(event.fields)) {
          const next = { ...stamp, value }
          if (beats(next, entity.fields.get(key))) entity.fields.set(key, next)
        }
        const hash = event.fields.md_hash
        if (event.op === 'doc.upsert' && typeof hash === 'string') {
          // A missing md_base reads as a fresh start (null): writers must send md_hash and md_base together.
          const base = typeof event.fields.md_base === 'string' ? event.fields.md_base : null
          push(versions, event.id, { ...stamp, hash, base })
        }
      })
    }
  }

  const text = (entity: Entity | undefined, key: string): string | null => {
    const value = entity?.fields.get(key)?.value
    return typeof value === 'string' ? value : null
  }
  /** Course, folder and name are all known; until then a document takes part in no naming rule. */
  const place = (entity: Entity | undefined): { course_id: string; rel_path: string; name: string } | null => {
    const course_id = text(entity, 'course_id'), rel_path = text(entity, 'rel_path'), name = text(entity, 'name')
    return course_id !== null && rel_path !== null && name !== null ? { course_id, rel_path, name } : null
  }
  const contentFile = (doc: string, hash: string, author: string): NoteFile | null =>
    (noteFiles.get(doc) ?? []).filter(file => file.hash === hash)
      .sort((a, b) => Number(b.author === author) - Number(a.author === author) || b.seq - a.seq || (b.path > a.path ? 1 : -1))[0] ?? null
  const missingAssets = (file: NoteFile | null): boolean => file?.assets.some(asset => !present.has(asset)) ?? false

  for (const [doc, entity] of state.docs) {
    const body = text(entity, 'md_hash')
    if (body === null) continue
    const own = versions.get(doc) ?? []
    /** Writer of a hash: the latest (t, device_id) among the versions that carry it. */
    const authorOf = (hash: string): string => own.filter(version => version.hash === hash)
      .reduce((best, version) => (beats({ ...version, value: hash }, { ...best, value: hash }) ? version : best)).device
    const bodyFile = contentFile(doc, body, authorOf(body))
    state.notes.set(doc, { hash: body, file: bodyFile?.path ?? null })
    if (isAlive(entity) && (bodyFile === null || missingAssets(bodyFile))) waitingDocs.add(doc)

    const where = place(entity)
    if (where === null) continue
    const bases = new Set(own.filter(version => version.base !== version.hash).map(version => version.base))
    const losers = [...new Set(own.map(version => version.hash))].filter(hash => hash !== body && !bases.has(hash))
    for (const hash of losers) {
      const id = uuidv5(`${doc}:${hash}`, CONFLICT_COPY_NAMESPACE)
      if (state.docs.has(id)) continue
      // Until the writer's device file arrives its id stands in; a derived copy's name is recomputed on every merge.
      const author = authorOf(hash), device = nameSafe((state.devices.get(author) ?? author.slice(0, 8)).normalize('NFC'))
      const [stem] = splitName(where.name)
      copies.push({
        id, of: doc, course_id: where.course_id, rel_path: where.rel_path,
        name: `${stem} (충돌 사본 ${device}).md`, md_hash: hash, file: contentFile(doc, hash, author)?.path ?? null
      })
    }
  }

  const byPath = new Map<string, string[]>()
  for (const [id, entity] of state.docs) {
    const where = place(entity)
    if (isAlive(entity) && where) push(byPath, pathKey(where.course_id, where.rel_path, where.name), id)
  }
  for (const ids of byPath.values()) {
    for (const id of ids.sort().slice(1)) {
      const [stem, ext] = splitName(text(state.docs.get(id), 'name')!)
      state.renames.push({ id, name: `${stem} (${id.slice(0, 4)})${ext}` })
    }
  }
  state.renames.sort((a, b) => (a.id < b.id ? -1 : 1))

  // Copies join the collision rule: a live document keeps its name, and among copies the smallest id does.
  // Copies still waiting for their text take part too, so a late note file never renames a made copy.
  const taken = new Set(byPath.keys())
  for (const copy of copies.sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const key = pathKey(copy.course_id, copy.rel_path, copy.name), [stem, ext] = splitName(copy.name)
    const name = taken.has(key) ? `${stem} (${copy.id.slice(0, 4)})${ext}` : copy.name
    taken.add(key)
    if (copy.file === null) state.waiting.copies.push(copy.id)
    else state.conflictCopies.push({ ...copy, name, file: copy.file })
  }

  for (const [id, entity] of state.docs) {
    if (!isAlive(entity)) continue
    const course = text(entity, 'course_id'), pdf = text(entity, 'pdf_sha256')
    if (course === null || !state.courses.has(course) || (text(entity, 'type') === 'pdf' && !present.has(`pdf/${pdf}.pdf`))) {
      waitingDocs.add(id)
    }
  }
  for (const [id, { value: { doc, object } }] of state.ink) {
    const image = object.del ? undefined : (object.data?.image as { sha256: string; ext: string } | undefined)
    if (!state.docs.has(doc) || (image && !present.has(`assets/${image.sha256}.${image.ext}`))) state.waiting.ink.push(id)
  }
  state.waiting.docs = [...waitingDocs].sort()
  state.waiting.ink.sort()
  state.waiting.copies.sort()
  return state
}
