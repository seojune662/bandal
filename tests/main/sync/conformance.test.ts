import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, test } from 'vitest'
import { importInkObject, toInkObject, type AssetRef } from '../../../src/main/features/sync/adapter'
import { readRoot, type InkObject, type ParsedFile, type RemoteFile } from '../../../src/main/features/sync/format'
import { isAlive, merge, type Entity, type MergedState } from '../../../src/main/features/sync/merge'
import { diameterFactorsV5 } from '../../../src/shared/inkV5'

const FIXTURES = join(__dirname, '../../../sync-fixtures')
const COURSE_FIELDS = ['name', 'sort', 'color', 'archived']
const DOC_FIELDS = ['course_id', 'type', 'name', 'rel_path', 'pdf_sha256', 'md_hash']

function loadRoot(dir: string): RemoteFile[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => {
    const full = join(entry.parentPath, entry.name)
    return { path: relative(dir, full).split(sep).join('/'), bytes: readFileSync(full) }
  })
}

const pick = (entity: Entity, keys: string[]): Record<string, unknown> =>
  Object.fromEntries(keys.filter(key => entity.fields.has(key)).map(key => [key, entity.fields.get(key)!.value]))

/** The `expected.json` shape described in sync-fixtures/README.md. */
function project(state: MergedState): Record<string, unknown> {
  const ink: Record<string, Record<string, Record<string, unknown>>> = {}
  for (const [id, { value: { doc, object } }] of state.ink) ((ink[doc] ??= {})[String(object.page)] ??= {})[id] = object
  return {
    blocked: state.blocked,
    courses: Object.fromEntries([...state.courses].map(([id, entity]) => [id, { ...pick(entity, COURSE_FIELDS), alive: isAlive(entity) }])),
    docs: Object.fromEntries([...state.docs].map(([id, entity]) => [id, { ...pick(entity, DOC_FIELDS), alive: isAlive(entity) }])),
    ink,
    notes: Object.fromEntries([...state.notes].map(([id, note]) => [id, { md_hash: note.hash, file: note.file }])),
    conflict_copies: state.conflictCopies,
    renames: state.renames,
    waiting: state.waiting
  }
}

/** Deterministic Fisher–Yates so a failing order can be replayed. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const result = [...items]
  let state = seed
  for (let index = result.length - 1; index > 0; index--) {
    state = (state * 1664525 + 1013904223) >>> 0
    const other = state % (index + 1)
    ;[result[index], result[other]] = [result[other], result[index]]
  }
  return result
}

/** Import into a local row, then export it again, as the engine would on the next change. */
function roundTrip(object: InkObject): InkObject {
  const result = importInkObject(object, asset => `images/${asset.sha256}.${asset.ext}`)
  if (result.action === 'delete') {
    const row = { id: object.id, page: object.page, kind: 'ink', data_json: '{}', style_json: '{}', created_at: result.deleted_at, updated_at: result.deleted_at, deleted_at: result.deleted_at }
    return toInkObject(row, object.t)!
  }
  if (result.action !== 'upsert') throw new Error(`${object.id} was not imported: ${result.reason}`)
  const { fields } = result, image = object.data?.image as AssetRef | undefined
  const row = {
    id: object.id, page: fields.page, kind: fields.kind, data_json: JSON.stringify(fields.data), style_json: JSON.stringify(fields.style),
    created_at: fields.created_at, updated_at: fields.updated_at, deleted_at: null
  }
  return toInkObject(row, object.t, image && { sha256: image.sha256, ext: image.ext })!
}

/** Every page coordinate an object reaches, box edges included. */
function geometry(object: InkObject): number[] {
  const points = (object.data?.points ?? []) as { x: number; y: number }[], box = object.data?.box as { x: number; y: number; width: number; height: number } | undefined
  return [...points.flatMap(point => [point.x, point.y]), ...(box ? [box.x, box.y, box.x + box.width, box.y + box.height] : [])]
}

const fixtures = readdirSync(FIXTURES).filter(name => /^\d\d-/.test(name))

test('every fixture folder is checked', () => {
  expect(fixtures).toEqual([
    '01-basic', '02-same-id-both-edited', '03-delete-then-edit', '04-note-both-edited', '05-note-attachments',
    '06-path-collision', '07-out-of-range-coordinates', '08-format-not-2', '09-invalid-input', '10-same-stamp'
  ])
})

describe.each(fixtures)('sync-fixtures/%s', name => {
  const { fixture, spec, ...expected } = JSON.parse(readFileSync(join(FIXTURES, name, 'expected.json'), 'utf8')) as Record<string, unknown>
  const { parsed, ignored, errors } = readRoot(loadRoot(join(FIXTURES, name, 'root')))

  test('root/ parses and merges to expected.json', () => {
    expect([fixture, spec]).toEqual([name, '2.2'])
    expect({ ...project(merge(parsed)), ignored, errors }).toEqual(expected)
  })

  test('arrival order and repeated files do not change the result (M14, M15)', () => {
    const want = project(merge(parsed))
    for (let seed = 1; seed <= 100; seed++) {
      const files: ParsedFile[] = shuffled([...parsed, ...parsed.filter((_, index) => (index + seed) % 3 === 0)], seed)
      expect(project(merge(files))).toEqual(want)
    }
  })

  test('the SyncAdapter round-trips every winning drawing', () => {
    for (const { value: { object } } of merge(parsed).ink.values()) {
      const once = roundTrip(object)
      // Import only ever clamps into the page, and that settles in one pass, so nothing is re-exported for it.
      expect(roundTrip(once)).toEqual(once)
      // Unknown top-level keys are not written back (spec: rewrite with known keys only).
      const known = Object.fromEntries(Object.entries(object).filter(([key]) => ['id', 'kind', 'page', 't', 'created', 'data', 'style', 'del'].includes(key)))
      if (name !== '07-out-of-range-coordinates') expect(once).toEqual(known)
      else expect(geometry(once).every(value => value >= 0 && value <= 1)).toBe(true)
    }
  })
})

test('V5 diameter factors match render/v5-diameter.json (R01)', () => {
  const render = JSON.parse(readFileSync(join(FIXTURES, 'render/v5-diameter.json'), 'utf8')) as {
    tolerance: number
    cases: { points: { x: number; y: number; p: number; t?: number }[]; width: number; aspect: number; highlighter: boolean; expectedFactors: number[] }[]
  }
  expect(render.cases.length).toBeGreaterThan(0)
  for (const sample of render.cases) {
    const factors = diameterFactorsV5(sample.points, sample.width, sample.aspect, sample.highlighter)
    expect(factors).toHaveLength(sample.expectedFactors.length)
    factors.forEach((factor, index) => expect(Math.abs(factor - sample.expectedFactors[index])).toBeLessThanOrEqual(render.tolerance))
  }
})
