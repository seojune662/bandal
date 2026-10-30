/**
 * Common sync spec v2.1 (`sync-fixtures/SPEC.md`): which cloud-root paths are
 * Bandal's, and validation of each file as untrusted input.
 *
 * A file that cannot be read at all (bad JSON or gzip, wrong shape, over its
 * size limit, wrong hash) is rejected whole. A single event or drawing with a
 * bad value is dropped on its own and counted, so it cannot hide its neighbours.
 */
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'

export const SYNC_FORMAT = 2

/** Size limits use MiB. */
const MIB = 1024 * 1024
/** t and created must be before 2100-01-01: keeps every clock + 1 a safe integer and a valid Date. */
export const MAX_STAMP = Date.UTC(2100, 0, 1)
const MAX_PAGE = 100_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SHA_RE = /^[0-9a-f]{64}$/
const EXT_RE = /^[a-z0-9]{1,16}$/
/** Unicode control characters (Cc): C0, DEL and C1. */
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/
const NOTE_ASSET_RE = /\.\.\/\.\.\/assets\/([0-9a-f]{64})\.([a-z0-9]{1,16})/g
const ID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'
const PATHS = {
  device: new RegExp(`^devices/${ID}\\.json$`),
  log: new RegExp(`^log/${ID}/(\\d{8})\\.json$`),
  pdf: /^pdf\/([0-9a-f]{64})\.pdf$/,
  asset: /^assets\/([0-9a-f]{64})\.([a-z0-9]{1,16})$/,
  ink: new RegExp(`^ink/${ID}/([1-9]\\d*)/${ID}-(\\d{8})\\.json\\.gz$`),
  note: new RegExp(`^notes/${ID}/${ID}-(\\d{8})\\.md$`)
}
const KNOWN_OPS = new Set(['course.upsert', 'course.delete', 'doc.upsert', 'doc.delete'])

export interface RemoteFile {
  /** Root-relative, `/`-separated. */
  path: string
  bytes: Uint8Array
}

export interface MetaEvent {
  t: number
  op: string
  id: string
  fields: Record<string, unknown>
}

/** One `pdf_drawings` row in spec form. A minimal tombstone is `{id, page, t, del}`. */
export interface InkObject {
  id: string
  page: number
  t: number
  del?: true
  kind?: string
  created?: number
  data?: Record<string, unknown>
  style?: Record<string, unknown>
  [key: string]: unknown
}

export type ParsedFile =
  | { kind: 'root'; path: string; format: number }
  | { kind: 'device'; path: string; device: string; name: string }
  /** `dropped` counts events that failed validation and were left out. */
  | { kind: 'log'; path: string; author: string; seq: number; events: MetaEvent[]; dropped: number }
  | { kind: 'ink'; path: string; author: string; seq: number; doc: string; objects: InkObject[]; dropped: number }
  /** `assets` lists the `assets/<sha>.<ext>` files the snapshot links to. */
  | { kind: 'note'; path: string; author: string; seq: number; doc: string; hash: string; assets: string[] }
  | { kind: 'pdf' | 'asset'; path: string; hash: string }

export class SyncFormatError extends Error {}

function fail(reason: string): never {
  throw new SyncFormatError(reason)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const isStamp = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < MAX_STAMP
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value)
export const isSha = (value: unknown): value is string => typeof value === 'string' && SHA_RE.test(value)
export const isAssetExt = (value: unknown): value is string => typeof value === 'string' && EXT_RE.test(value)
export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/** JSON can still spell Infinity (`1e999`), which no file may carry. */
function allFinite(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(allFinite)
  return isRecord(value) ? Object.values(value).every(allFinite) : true
}

const text = (bytes: Uint8Array): string => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8')

function json(bytes: Uint8Array, limit: number): unknown {
  if (bytes.byteLength > limit) fail('file is over its size limit')
  const value: unknown = JSON.parse(text(bytes))
  if (!allFinite(value)) fail('non-finite number')
  return value
}

const validSegment = (segment: string): boolean =>
  segment !== '' && segment !== '.' && segment !== '..' && !CONTROL_RE.test(segment)

/**
 * File name with extension: one path segment. `\`, `:` and other names Windows
 * cannot store are legal here; the Windows apply step maps them to safe local names.
 */
const isDocName = (value: unknown): value is string =>
  typeof value === 'string' && !value.includes('/') && validSegment(value)

/** Folder inside the course: `""` or relative `/`-separated segments, never `..` or absolute. */
const isDocFolder = (value: unknown): value is string =>
  typeof value === 'string' && (value === '' || value.split('/').every(validSegment))

function courseFields(fields: Record<string, unknown>): Record<string, unknown> | null {
  if (fields.name !== undefined && typeof fields.name !== 'string') return null
  if (fields.sort !== undefined && typeof fields.sort !== 'number') return null
  if (fields.color !== undefined && typeof fields.color !== 'string') return null
  if (fields.archived !== undefined && typeof fields.archived !== 'boolean') return null
  return fields
}

function docFields(fields: Record<string, unknown>): Record<string, unknown> | null {
  const name = typeof fields.name === 'string' ? fields.name.normalize('NFC') : fields.name
  const folder = typeof fields.rel_path === 'string' ? fields.rel_path.normalize('NFC') : fields.rel_path
  if (fields.course_id !== undefined && !isUuid(fields.course_id)) return null
  if (fields.type !== undefined && fields.type !== 'pdf' && fields.type !== 'md') return null
  if ((name !== undefined && !isDocName(name)) || (folder !== undefined && !isDocFolder(folder))) return null
  if ((fields.pdf_sha256 !== undefined && !isSha(fields.pdf_sha256)) || (fields.md_hash !== undefined && !isSha(fields.md_hash))) return null
  if (fields.md_base !== undefined && fields.md_base !== null && !isSha(fields.md_base)) return null
  return {
    ...fields,
    ...(name === undefined ? {} : { name }),
    ...(folder === undefined ? {} : { rel_path: folder })
  }
}

/** A known op with a bad stamp, id or field value is dropped; unknown ops are skipped unread. */
function event(value: unknown): MetaEvent | null | 'skip' {
  if (!isRecord(value) || typeof value.op !== 'string') return null
  if (!KNOWN_OPS.has(value.op)) return 'skip'
  if (!isStamp(value.t) || !isUuid(value.id)) return null
  const raw = value.fields ?? {}
  if (!isRecord(raw)) return null
  const fields = value.op === 'course.upsert' ? courseFields(raw) : value.op === 'doc.upsert' ? docFields(raw) : raw
  return fields === null ? null : { t: value.t, op: value.op, id: value.id, fields }
}

function inkObject(value: unknown): InkObject | null {
  if (!isRecord(value) || !isUuid(value.id) || !isStamp(value.t)) return null
  if (!Number.isInteger(value.page) || (value.page as number) < 1 || (value.page as number) > MAX_PAGE) return null
  if (value.del !== undefined && value.del !== true) return null
  if (value.del === true) return value as InkObject
  if (typeof value.kind !== 'string' || !isStamp(value.created) || !isRecord(value.data) || !isRecord(value.style)) return null
  const image = value.data.image
  if (image !== undefined && (!isRecord(image) || !isSha(image.sha256) || !isAssetExt(image.ext))) return null
  return value as InkObject
}

function items<T>(value: unknown, what: string, check: (item: unknown) => T | null | 'skip'): { items: T[]; dropped: number } {
  if (!Array.isArray(value)) fail(`${what} is not an array`)
  const kept: T[] = []
  let dropped = 0
  for (const item of value) {
    const result = check(item)
    if (result === null) dropped++
    else if (result !== 'skip') kept.push(result)
  }
  return { items: kept, dropped }
}

/** Placeholder of a file iCloud has not downloaded: `dir/.name.icloud` stands for `dir/name`. */
export function placeholderTarget(path: string): string | null {
  const match = /^(.*\/)?\.(.+)\.icloud$/.exec(path)
  return match ? `${match[1] ?? ''}${match[2]}` : null
}

const isSpecPath = (path: string): boolean => path === 'bandal.json' || Object.values(PATHS).some(pattern => pattern.test(path))

/** `null` means the path is outside the spec's patterns and must be ignored. */
export function parseFile({ path, bytes }: RemoteFile): ParsedFile | null {
  let match: RegExpExecArray | null
  if (path === 'bandal.json') {
    const root = json(bytes, MIB)
    if (!isRecord(root) || !Number.isSafeInteger(root.format)) fail('bandal.json format')
    return { kind: 'root', path, format: root.format as number }
  }
  if ((match = PATHS.device.exec(path))) {
    const device = json(bytes, MIB)
    if (!isRecord(device) || typeof device.name !== 'string') fail('device name')
    return { kind: 'device', path, device: match[1]!, name: device.name }
  }
  if ((match = PATHS.log.exec(path))) {
    const { items: events, dropped } = items(json(bytes, 4 * MIB), 'log', event)
    return { kind: 'log', path, author: match[1]!, seq: Number(match[2]), events, dropped }
  }
  if ((match = PATHS.ink.exec(path))) {
    if (Number(match[2]) > MAX_PAGE) fail('ink page')
    const unzipped = gunzipSync(bytes, { maxOutputLength: 64 * MIB })
    const { items: objects, dropped } = items(json(unzipped, 64 * MIB), 'ink', inkObject)
    return { kind: 'ink', path, doc: match[1]!, author: match[3]!, seq: Number(match[4]), objects, dropped }
  }
  if ((match = PATHS.note.exec(path))) {
    if (bytes.byteLength > 16 * MIB) fail('note is over its size limit')
    const assets = [...new Set([...text(bytes).matchAll(NOTE_ASSET_RE)].map(link => `assets/${link[1]}.${link[2]}`))].sort()
    return { kind: 'note', path, doc: match[1]!, author: match[2]!, seq: Number(match[3]), hash: sha256(bytes), assets }
  }
  const content = PATHS.pdf.exec(path) ?? PATHS.asset.exec(path)
  if (content) {
    if (sha256(bytes) !== content[1]) fail('content does not match its hash')
    return { kind: path.startsWith('pdf/') ? 'pdf' : 'asset', path, hash: content[1]! }
  }
  return null
}

/**
 * Sorts a whole root into parsed files, ignored paths, unreadable paths and
 * iCloud placeholders (`pending`, listed by the path they stand for).
 */
export function readRoot(files: readonly RemoteFile[]): { parsed: ParsedFile[]; ignored: string[]; errors: string[]; pending: string[] } {
  const parsed: ParsedFile[] = [], ignored: string[] = [], errors: string[] = [], pending: string[] = []
  for (const file of files) {
    const target = placeholderTarget(file.path)
    if (target !== null && isSpecPath(target)) {
      pending.push(target)
      continue
    }
    try {
      const result = parseFile(file)
      if (result) parsed.push(result)
      else ignored.push(file.path)
    } catch {
      errors.push(file.path)
    }
  }
  return { parsed, ignored: ignored.sort(), errors: errors.sort(), pending: pending.sort() }
}
