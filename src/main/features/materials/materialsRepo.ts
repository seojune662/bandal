/**
 * Materials repository. Source of truth is the course folder on disk;
 * `materials_index` is a rebuildable cache used only for search.
 */

import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync
} from 'node:fs'
import { basename, extname, isAbsolute, join, posix } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type {
  ImportResult,
  MaterialFileContent,
  MaterialKind,
  MaterialNode,
  MaterialSearchHit
} from '../../../shared/types/materials'
import { NotFoundError, ValidationError } from '../../db/errors'
import { nowIso, requireId, requireNonEmptyString, resolveInside } from '../../db/validate'

export interface MaterialsRepo {
  tree(courseId: string): MaterialNode[]
  search(courseId: string, query: string): MaterialSearchHit[]
  import(courseId: string, paths: string[]): ImportResult
  readFile(courseId: string, relPath: string): MaterialFileContent
  reveal(courseId: string, relPath: string): { ok: true }
}

export interface MaterialsRepoDeps {
  db: Database
  /** Absolute course folder for a live course id (throws otherwise). */
  getCourseFolder: (courseId: string) => string
  /** Reveals an absolute path in the OS file manager (electron shell). */
  revealItem: (absPath: string) => void
}

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif', '.heic'
])
const TEXT_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.csv', '.tsv', '.json', '.yml', '.yaml',
  '.xml', '.html', '.css', '.js', '.ts', '.tex', '.log', '.srt', '.vtt'
])
/** Files larger than this are refused by readFile (base64 over IPC). */
const MAX_READ_BYTES = 64 * 1024 * 1024

export function kindForFile(fileName: string): MaterialKind {
  const ext = extname(fileName).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (ext === '.md' || ext === '.markdown') return 'note'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  return 'other'
}

function isHidden(name: string): boolean {
  return name.startsWith('.')
}

function walkDir(absDir: string, relDir: string): MaterialNode[] {
  const entries = readdirSync(absDir, { withFileTypes: true })
    .filter((entry) => !isHidden(entry.name))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })

  const nodes: MaterialNode[] = []
  for (const entry of entries) {
    const relPath = relDir === '' ? entry.name : posix.join(relDir, entry.name)
    const absPath = join(absDir, entry.name)
    if (entry.isDirectory()) {
      nodes.push({
        relPath,
        name: entry.name,
        kind: 'dir',
        children: walkDir(absPath, relPath)
      })
    } else if (entry.isFile()) {
      const stat = statSync(absPath)
      nodes.push({
        relPath,
        name: entry.name,
        kind: kindForFile(entry.name),
        size: stat.size,
        mtime: Math.round(stat.mtimeMs)
      })
    }
    // Symlinks and other entry types are intentionally skipped.
  }
  return nodes
}

function flattenFiles(nodes: MaterialNode[]): MaterialNode[] {
  const files: MaterialNode[] = []
  for (const node of nodes) {
    if (node.kind === 'dir') {
      files.push(...flattenFiles(node.children ?? []))
    } else {
      files.push(node)
    }
  }
  return files
}

/** Picks `name.ext`, `name (2).ext`, … until the target does not exist. */
function unusedTargetName(dir: string, fileName: string): string {
  const ext = extname(fileName)
  const stem = basename(fileName, ext)
  for (let n = 1; n < 1000; n += 1) {
    const candidate = n === 1 ? fileName : `${stem} (${n})${ext}`
    if (!existsSync(join(dir, candidate))) {
      return candidate
    }
  }
  throw new ValidationError(`could not find a free name for "${fileName}"`)
}

export function createMaterialsRepo(deps: MaterialsRepoDeps): MaterialsRepo {
  const { db, getCourseFolder, revealItem } = deps

  /** Rebuilds the materials_index cache for a course from disk. */
  function rebuildIndex(courseId: string, folder: string): void {
    const files = flattenFiles(walkDir(folder, ''))
    const now = nowIso()
    const rebuild = db.transaction(() => {
      db.prepare('DELETE FROM materials_index WHERE course_id = ?').run(courseId)
      const insert = db.prepare(
        `INSERT INTO materials_index
           (id, course_id, rel_path, kind, size, mtime, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      for (const file of files) {
        insert.run(
          randomUUID(),
          courseId,
          file.relPath,
          file.kind,
          file.size ?? 0,
          file.mtime ?? 0,
          now,
          now
        )
      }
    })
    rebuild()
  }

  function resolveMaterial(courseId: string, relPath: string): { abs: string; folder: string } {
    const id = requireId(courseId, 'courseId')
    const folder = getCourseFolder(id)
    const abs = resolveInside(folder, requireNonEmptyString(relPath, 'relPath'))
    return { abs, folder }
  }

  return {
    tree(courseId) {
      const id = requireId(courseId, 'courseId')
      const folder = getCourseFolder(id)
      if (!existsSync(folder)) {
        // Folder was removed out-of-band; surface an empty tree, not a crash.
        console.warn(`[materials] course folder missing on disk: ${folder}`)
        return []
      }
      return walkDir(folder, '')
    },

    search(courseId, query) {
      const id = requireId(courseId, 'courseId')
      const folder = getCourseFolder(id)
      const needle = requireNonEmptyString(query, 'query').trim().toLowerCase()
      if (!existsSync(folder)) {
        return []
      }
      rebuildIndex(id, folder)

      const rows = db
        .prepare(
          `SELECT rel_path, kind FROM materials_index
           WHERE course_id = ?
             AND deleted_at IS NULL
             AND instr(lower(rel_path), ?) > 0
           ORDER BY rel_path ASC`
        )
        .all(id, needle) as { rel_path: string; kind: MaterialKind }[]

      return rows
        .map((row) => {
          const name = posix.basename(row.rel_path)
          const lowerName = name.toLowerCase()
          let score = 1
          if (lowerName.includes(needle)) score = 2
          if (lowerName.startsWith(needle)) score = 3
          return { relPath: row.rel_path, name, kind: row.kind, score }
        })
        .sort((a, b) => b.score - a.score || a.relPath.localeCompare(b.relPath))
    },

    import(courseId, paths) {
      const id = requireId(courseId, 'courseId')
      const folder = getCourseFolder(id)
      // An arbitrary course folder can disappear (moved / unmounted); never
      // re-create it silently under a stale path.
      if (!existsSync(folder)) {
        throw new NotFoundError('course folder', folder)
      }
      if (!Array.isArray(paths) || paths.length === 0) {
        throw new ValidationError('paths must be a non-empty array')
      }

      const imported: string[] = []
      const failed: ImportResult['failed'] = []
      for (const sourcePath of paths) {
        try {
          const source = requireNonEmptyString(sourcePath, 'path')
          if (!isAbsolute(source)) {
            throw new ValidationError(`"${source}" is not an absolute path`)
          }
          if (!existsSync(source)) {
            throw new NotFoundError('file', source)
          }
          if (!statSync(source).isFile()) {
            throw new ValidationError(`"${source}" is not a regular file`)
          }
          const targetName = unusedTargetName(folder, basename(source))
          copyFileSync(source, join(folder, targetName))
          imported.push(targetName)
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          failed.push({ path: String(sourcePath), reason })
        }
      }
      return { imported, failed }
    },

    readFile(courseId, relPath) {
      const { abs } = resolveMaterial(courseId, relPath)
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        throw new NotFoundError('material', relPath)
      }
      const size = statSync(abs).size
      if (size > MAX_READ_BYTES) {
        throw new ValidationError(
          `"${relPath}" is too large to read over IPC (${size} bytes)`
        )
      }
      const ext = extname(abs).toLowerCase()
      if (TEXT_EXTENSIONS.has(ext)) {
        return { encoding: 'utf8', data: readFileSync(abs, 'utf8') }
      }
      return { encoding: 'base64', data: readFileSync(abs).toString('base64') }
    },

    reveal(courseId, relPath) {
      const { abs } = resolveMaterial(courseId, relPath)
      if (!existsSync(abs)) {
        throw new NotFoundError('material', relPath)
      }
      revealItem(abs)
      return { ok: true }
    }
  }
}
