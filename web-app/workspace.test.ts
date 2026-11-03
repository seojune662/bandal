/**
 * The web app reads Drive with the desktop parser and merge, but on the browser
 * shims (async-prepared SHA-256 and gunzip). This runs that exact path over
 * every conformance fixture and checks it against `expected.json`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('node:crypto', () => import('./shims/node-crypto'))
vi.mock('node:zlib', () => import('./shims/node-zlib'))

const { loadWorkspace } = await import('./workspace')
type Drive = Parameters<typeof loadWorkspace>[0]

const FIXTURES = join(__dirname, '..', 'sync-fixtures')
const fixtures = readdirSync(FIXTURES).filter(name => /^\d\d-/.test(name))

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

function fakeDrive(root: string): Drive {
  const files = new Map(walk(root).map(path => {
    const rel = relative(root, path).split(sep).join('/')
    return [rel, { id: rel, name: rel.split('/').at(-1)!, mimeType: 'application/octet-stream', md5Checksum: rel, size: String(statSync(path).size) }]
  }))
  return {
    account: async () => ({ email: 'student@example.com', name: null, photo: null }),
    findRoot: async () => 'root',
    listRoot: async () => files,
    download: async file => new Uint8Array(readFileSync(join(root, file.id)))
  }
}

interface Expected {
  blocked: string | null
  errors: string[]
  courses: Record<string, { name?: string; alive: boolean }>
  docs: Record<string, { name?: string; rel_path?: string; course_id?: string; type?: string; alive: boolean }>
  ink: Record<string, Record<string, Record<string, { del?: true }>>>
  conflict_copies: { id: string; name: string; rel_path: string; course_id: string }[]
  renames: { id: string; name: string }[]
  waiting: { docs: string[]; ink: string[]; copies: string[] }
}

describe('web app sync reader on browser shims', () => {
  for (const name of fixtures) {
    it(name, async () => {
      const expected = JSON.parse(readFileSync(join(FIXTURES, name, 'expected.json'), 'utf8')) as Expected
      const result = await loadWorkspace(fakeDrive(join(FIXTURES, name, 'root')), new Map(), () => {})
      if (expected.blocked !== null) {
        expect(result).toEqual({ status: 'blocked', reason: expected.blocked })
        return
      }
      expect(result.status).toBe('ready')
      if (result.status !== 'ready') return
      const { workspace } = result
      // PDFs and assets count as present by name and are hash-checked when opened, as the desktop's pull does (pull.ts).
      expect(workspace.errors).toEqual(expected.errors.filter(path => !/^(pdf|assets)\//.test(path)))

      const liveCourses = Object.entries(expected.courses).filter(([, course]) => course.alive && course.name)
      expect(workspace.courses.map(course => [course.id, course.name]).sort()).toEqual(liveCourses.map(([id, course]) => [id, course.name!.trim()]).sort())

      const live = new Set(liveCourses.map(([id]) => id))
      const renames = new Map(expected.renames.map(rename => [rename.id, rename.name]))
      const waiting = new Set(expected.waiting.docs)
      const wantDocs = Object.entries(expected.docs)
        .filter(([id, doc]) => doc.alive && !waiting.has(id) && doc.course_id && live.has(doc.course_id) && doc.name && doc.rel_path !== undefined)
        .map(([id, doc]) => {
          const file = renames.get(id) ?? doc.name!
          return [id, doc.rel_path ? `${doc.rel_path}/${file}` : file]
        })
      const wantCopies = expected.conflict_copies.filter(copy => live.has(copy.course_id)).map(copy => [copy.id, copy.rel_path ? `${copy.rel_path}/${copy.name}` : copy.name])
      expect([...workspace.docs.values()].map(doc => [doc.id, doc.relPath]).sort()).toEqual([...wantDocs, ...wantCopies].sort())

      const waitingInk = new Set(expected.waiting.ink)
      const wantInk = Object.entries(expected.ink).flatMap(([doc, pages]) => Object.values(pages).flatMap(objects =>
        Object.entries(objects).filter(([id, object]) => !object.del && !waitingInk.has(id)).map(([id]) => `${doc}/${id}`)))
      const gotInk = [...workspace.ink].flatMap(([doc, objects]) => objects.map(object => `${doc}/${object.id}`))
      expect(gotInk.sort()).toEqual(wantInk.sort())
    })
  }
})
