/**
 * SyncAdapter mappings between local rows and spec v2.1 values (design 3.2–3.4).
 * Pure: the engine supplies timestamps, asset hashes and image paths.
 */
import type { DrawingData, DrawingKind, DrawingStyle } from '../../../shared/types/drawing'
import { DRAWING_KINDS } from '../../../shared/types/drawing'
import { ValidationError } from '../../db/errors'
import { assertDrawingData, assertDrawingStyle } from '../drawingValidation'
import { isAssetExt, isSha, type InkObject } from './format'

export interface DrawingRow {
  id: string
  page: number
  kind: string
  data_json: string
  style_json: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface AssetRef {
  sha256: string
  ext: string
}

export interface DrawingFields {
  kind: DrawingKind
  page: number
  data: DrawingData
  style: DrawingStyle
  created_at: string
  updated_at: string
}

/** What applying one merged drawing should do to the local row. */
export type DrawingImport =
  | { action: 'upsert'; fields: DrawingFields }
  | { action: 'delete'; deleted_at: string }
  /** Keep it in sync state only: a kind this version cannot draw, or an image with no local file yet. */
  | { action: 'hold'; reason: 'unknown-kind' | 'needs-asset' }

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value)
const within = (value: unknown, min: number, max: number): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

/** Spec rounding: nearest, ties away from zero, on the binary64 value scaled by 10^digits. −0 is written as 0. */
export function roundAway(value: number, digits: number): number {
  const scale = 10 ** digits
  const rounded = (Math.sign(value) * Math.round(Math.abs(value) * scale)) / scale
  return rounded === 0 ? 0 : rounded
}

/** `assets/<sha>.<ext>` extension: the file's own extension in lower case, or `bin` when it has none or a disallowed one. */
export function assetExt(fileName: string): string {
  const base = fileName.slice(fileName.lastIndexOf('/') + 1), dot = base.lastIndexOf('.')
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
  return isAssetExt(ext) ? ext : 'bin'
}

/** Non-numbers pass through untouched so validation rejects them instead of reading them as 0. */
const clamp = (value: unknown): unknown => (typeof value === 'number' ? Math.min(1, Math.max(0, value)) : value)

/** Applies `point` and `box` to well-formed entries only; anything else is left for validation to reject. */
function mapGeometry(data: Json, point: (value: Json) => Json, box: (value: Json) => Json): Json {
  return {
    ...data,
    ...(Array.isArray(data.points) ? { points: data.points.map(item => (isRecord(item) ? point(item) : item)) } : {}),
    ...(isRecord(data.box) ? { box: box(data.box) } : {})
  }
}

const roundNumber = (value: unknown, digits: number): unknown => (typeof value === 'number' ? roundAway(value, digits) : value)

/** Course row → `course.upsert` fields. */
export function courseFields(row: { name: string; sort_order: number; color: string; archived: number }): Json {
  return { name: row.name, sort: row.sort_order, color: row.color, archived: row.archived !== 0 }
}

/** Course-relative material path → the spec's folder and file name, both NFC. */
export function docLocation(relPath: string): { rel_path: string; name: string } {
  const path = relPath.normalize('NFC'), slash = path.lastIndexOf('/')
  return { rel_path: slash < 0 ? '' : path.slice(0, slash), name: path.slice(slash + 1) }
}

/**
 * `pdf_drawings` row → spec object, or null when it cannot be exported: a board
 * clip (local in v1) or an image whose asset hash is not given. A deleted row
 * becomes a minimal tombstone. Coordinates round to 5 digits and pressure to 3;
 * the stored row is untouched.
 */
export function toInkObject(row: DrawingRow, t: number, image?: AssetRef): InkObject | null {
  if (row.kind === 'clip') return null
  if (row.deleted_at) return { id: row.id, page: row.page, t, del: true }
  const parsed = JSON.parse(row.data_json) as Json
  let data = mapGeometry(parsed,
    point => ({ ...point, x: roundNumber(point.x, 5), y: roundNumber(point.y, 5), p: roundNumber(point.p, 3) }),
    box => ({ ...box, x: roundNumber(box.x, 5), y: roundNumber(box.y, 5), width: roundNumber(box.width, 5), height: roundNumber(box.height, 5) }))
  if (row.kind === 'image') {
    if (!image) return null
    const { label, widthPx, heightPx } = (isRecord(parsed.image) ? parsed.image : {}) as Json
    data = { ...data, image: { sha256: image.sha256, ext: image.ext, label, ...(widthPx === undefined ? {} : { widthPx, heightPx }) } }
  }
  return { id: row.id, kind: row.kind, page: row.page, t, created: Date.parse(row.created_at), data, style: JSON.parse(row.style_json) as Json }
}

/** Optional pen samples outside the local ranges are dropped rather than failing the stroke. */
function importPoint(point: Json): Json {
  const { t, tiltX, tiltY, ...rest } = point
  return {
    ...rest, x: clamp(rest.x), y: clamp(rest.y), p: clamp(rest.p),
    ...(within(t, 0, 86_400_000) ? { t } : {}),
    ...(within(tiltX, -90, 90) ? { tiltX } : {}),
    ...(within(tiltY, -90, 90) ? { tiltY } : {})
  }
}

function importBox(box: Json): Json {
  const left = clamp(box.x), top = clamp(box.y)
  const fit = (size: unknown, start: unknown): unknown =>
    typeof size === 'number' && typeof start === 'number' ? Math.min(Math.max(0, size), 1 - start) : size
  return { ...box, x: left, y: top, width: fit(box.width, left), height: fit(box.height, top) }
}

/**
 * Merged spec object → local change. Clamps geometry into the page, then
 * validates like a local save; content that still fails throws ValidationError.
 */
export function importInkObject(object: InkObject, imagePath: (asset: AssetRef) => string | null = () => null): DrawingImport {
  if (object.del) return { action: 'delete', deleted_at: new Date(object.t).toISOString() }
  if (!DRAWING_KINDS.includes(object.kind as DrawingKind) || object.kind === 'clip') return { action: 'hold', reason: 'unknown-kind' }
  const kind = object.kind as DrawingKind
  const { inkVersion, ...rest } = mapGeometry(object.data ?? {}, importPoint, importBox)
  let data: Json = kind === 'ink' || kind === 'highlighter' ? { ...rest, ...(inkVersion === undefined ? {} : { inkVersion }) } : rest
  if (kind === 'image') {
    const image = data.image
    if (!isRecord(image) || !isSha(image.sha256) || !isAssetExt(image.ext)) throw new ValidationError('data.image needs a sha256 and ext')
    const relPath = imagePath({ sha256: image.sha256, ext: image.ext })
    if (relPath === null) return { action: 'hold', reason: 'needs-asset' }
    const { sha256, ext, ...source } = image
    const label = typeof source.label === 'string' && source.label.trim() !== '' ? source.label : `${sha256.slice(0, 8)}.${ext}`
    data = { ...data, image: { ...source, label, relPath } }
  }
  return {
    action: 'upsert',
    fields: {
      kind, page: object.page,
      data: assertDrawingData(data, kind), style: assertDrawingStyle(object.style),
      created_at: new Date(object.created ?? object.t).toISOString(), updated_at: new Date(object.t).toISOString()
    }
  }
}
