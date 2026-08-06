/**
 * Materials repository. Source of truth is the course folder on disk;
 * `materials_index` is a rebuildable cache used only for search.
 */

import {
  cpSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync
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
import { ConflictError, NotFoundError, ValidationError } from '../../db/errors'
import { nowIso, requireId, requireNonEmptyString, resolveInside } from '../../db/validate'

export interface MaterialsRepo {
  tree(courseId: string): MaterialNode[]
  search(courseId: string, query: string): MaterialSearchHit[]
  import(courseId: string, paths: string[]): ImportResult
  readFile(courseId: string, relPath: string): MaterialFileContent
  reveal(courseId: string, relPath: string): { ok: true }
  rename(input: {
    courseId: string
    relPath: string
    newName: string
  }): { relPath: string }
  softDelete(input: {
    courseId: string
    relPath: string
  }): Promise<{ ok: true }>
  duplicate(input: {
    courseId: string
    relPath: string
  }): { relPath: string }
  createFolder(input: {
    courseId: string
    dirRelPath: string
    name: string
  }): { relPath: string }
  writeFile(input: {
    courseId: string
    dirRelPath: string
    fileName: string
    encoding: 'utf8' | 'base64'
    data: string
  }): { relPath: string }
}

export interface MaterialsRepoDeps {
  db: Database
  /** Absolute course folder for a live course id (throws otherwise). */
  getCourseFolder: (courseId: string) => string
  /** Reveals an absolute path in the OS file manager (electron shell). */
  revealItem: (absPath: string) => void
  /** Moves an absolute path to the OS trash (electron shell.trashItem). */
  trashItem: (absPath: string) => Promise<void>
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
/** Clipboard payloads are copied over IPC, so cap their decoded size. */
const MAX_WRITE_BYTES = 50 * 1024 * 1024

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

/** Picks `name-2.ext`, `name-3.ext`, …, matching duplicate's convention. */
function unusedDuplicateName(dir: string, fileName: string): string {
  const extension = extname(fileName)
  const stem = extension === '' ? fileName : basename(fileName, extension)
  for (let number = 2; number <= 1000; number += 1) {
    const candidate = `${stem}-${number}${extension}`
    if (!existsSync(join(dir, candidate))) return candidate
  }
  throw new ValidationError(`could not find a free name for "${fileName}"`)
}

function decodeWriteData(
  encoding: unknown,
  data: unknown
): Buffer {
  if (encoding !== 'utf8' && encoding !== 'base64') {
    throw new ValidationError('encoding must be "utf8" or "base64"')
  }
  if (typeof data !== 'string') {
    throw new ValidationError('data must be a string')
  }

  const byteLength = Buffer.byteLength(data, encoding)
  if (byteLength > MAX_WRITE_BYTES) {
    throw new ValidationError(
      `material is too large to write over IPC (${byteLength} bytes; maximum ${MAX_WRITE_BYTES} bytes)`
    )
  }
  const bytes = Buffer.from(data, encoding)
  // Keep the post-decode check too: malformed base64 must never bypass the cap.
  if (bytes.byteLength > MAX_WRITE_BYTES) {
    throw new ValidationError(
      `material is too large to write over IPC (${bytes.byteLength} bytes; maximum ${MAX_WRITE_BYTES} bytes)`
    )
  }
  return bytes
}

/**
 * Validates a single filesystem entry name. Unlike a path sanitizer, this
 * rejects separators instead of deleting them: renderer input must never be
 * transformed into a different path and then accepted.
 */
function requireBasename(value: unknown, field: string): string {
  const name = requireNonEmptyString(value, field).trim()
  if (name.includes('/') || name.includes('\\')) {
    throw new ValidationError(`${field} must be a basename without path separators`)
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(name)) {
    throw new ValidationError(`${field} contains control characters`)
  }
  if (name === '.' || name === '..') {
    throw new ValidationError(`${field} must name a file or folder`)
  }
  if (/[:*?"<>|]/.test(name)) {
    throw new ValidationError(`${field} contains filesystem-hostile characters`)
  }
  if (name.length > 120) {
    throw new ValidationError(`${field} must be at most 120 characters`)
  }
  return name
}

function assertFileOrDirectory(absPath: string, relPath: string): 'file' | 'dir' {
  if (!existsSync(absPath)) {
    throw new NotFoundError('material', relPath)
  }
  const stat = lstatSync(absPath)
  if (stat.isFile()) return 'file'
  if (stat.isDirectory()) return 'dir'
  throw new ValidationError(`"${relPath}" is not a regular file or directory`)
}

export function createMaterialsRepo(deps: MaterialsRepoDeps): MaterialsRepo {
  const { db, getCourseFolder, revealItem, trashItem } = deps

  function requireCourseFolder(courseId: string): { id: string; folder: string } {
    const id = requireId(courseId, 'courseId')
    const folder = getCourseFolder(id)
    if (!existsSync(folder)) {
      throw new NotFoundError('course folder', folder)
    }
    return { id, folder }
  }

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
    const { folder } = requireCourseFolder(courseId)
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
    },

    rename(input) {
      const { abs: sourceAbs, folder } = resolveMaterial(
        input.courseId,
        input.relPath
      )
      assertFileOrDirectory(sourceAbs, input.relPath)
      const newName = requireBasename(input.newName, 'newName')
      const parentRelPath = posix.dirname(input.relPath)
      const destinationRelPath =
        parentRelPath === '.' ? newName : posix.join(parentRelPath, newName)
      // Validate the destination independently before any existence check or
      // mutation. This remains necessary even though newName is a basename.
      const destinationAbs = resolveInside(folder, destinationRelPath)
      if (destinationAbs === sourceAbs) return { relPath: input.relPath }
      if (existsSync(destinationAbs)) {
        throw new ConflictError(`material "${destinationRelPath}" already exists`)
      }
      renameSync(sourceAbs, destinationAbs)
      return { relPath: destinationRelPath }
    },

    async softDelete(input) {
      const { abs } = resolveMaterial(input.courseId, input.relPath)
      assertFileOrDirectory(abs, input.relPath)
      await trashItem(abs)
      return { ok: true }
    },

    duplicate(input) {
      const { abs: sourceAbs, folder } = resolveMaterial(
        input.courseId,
        input.relPath
      )
      const sourceKind = assertFileOrDirectory(sourceAbs, input.relPath)
      const sourceName = posix.basename(input.relPath)
      const parentRelPath = posix.dirname(input.relPath)
      const parentAbs =
        parentRelPath === '.'
          ? folder
          : resolveInside(folder, parentRelPath)
      const candidateName = unusedDuplicateName(parentAbs, sourceName)
      const candidateRelPath =
        parentRelPath === '.'
          ? candidateName
          : posix.join(parentRelPath, candidateName)
      const candidateAbs = resolveInside(folder, candidateRelPath)
      if (sourceKind === 'dir') {
        cpSync(sourceAbs, candidateAbs, {
          recursive: true,
          errorOnExist: true,
          force: false
        })
      } else {
        copyFileSync(sourceAbs, candidateAbs)
      }
      return { relPath: candidateRelPath }
    },

    createFolder(input) {
      const { folder } = requireCourseFolder(input.courseId)
      if (typeof input.dirRelPath !== 'string') {
        throw new ValidationError('dirRelPath must be a string')
      }
      const parentAbs = resolveInside(folder, input.dirRelPath, { allowRoot: true })
      if (!existsSync(parentAbs) || !lstatSync(parentAbs).isDirectory()) {
        throw new NotFoundError('material directory', input.dirRelPath)
      }
      const name = requireBasename(input.name, 'name')
      const relPath =
        input.dirRelPath === '' ? name : posix.join(input.dirRelPath, name)
      const abs = resolveInside(folder, relPath)
      if (existsSync(abs)) {
        throw new ConflictError(`material "${relPath}" already exists`)
      }
      mkdirSync(abs)
      return { relPath }
    },

    writeFile(input) {
      const { folder } = requireCourseFolder(input.courseId)
      if (typeof input.dirRelPath !== 'string') {
        throw new ValidationError('dirRelPath must be a string')
      }
      const parentAbs = resolveInside(folder, input.dirRelPath, { allowRoot: true })
      if (!existsSync(parentAbs) || !lstatSync(parentAbs).isDirectory()) {
        throw new NotFoundError('material directory', input.dirRelPath)
      }

      const requestedName = requireBasename(input.fileName, 'fileName')
      const requestedRelPath =
        input.dirRelPath === ''
          ? requestedName
          : posix.join(input.dirRelPath, requestedName)
      const requestedAbs = resolveInside(folder, requestedRelPath)
      const fileName = existsSync(requestedAbs)
        ? unusedDuplicateName(parentAbs, requestedName)
        : requestedName
      const relPath =
        input.dirRelPath === '' ? fileName : posix.join(input.dirRelPath, fileName)
      const abs = resolveInside(folder, relPath)
      const bytes = decodeWriteData(input.encoding, input.data)
      writeFileSync(abs, bytes, { flag: 'wx' })
      return { relPath }
    }
  }
}
