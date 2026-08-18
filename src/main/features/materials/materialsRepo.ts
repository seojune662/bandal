/**
 * Materials repository. Source of truth is the course folder on disk;
 * `materials_index` is a rebuildable cache used by search and the dossier.
 */

import {
  cpSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  opendirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs'
import type { Dirent } from 'node:fs'
import { basename, extname, isAbsolute, join, posix, sep } from 'node:path'
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
  /**
   * 캐시된 트리를 버린다. 저장소 자신의 변이는 내부에서 알아서 무효화하므로,
   * 밖에서(watcher, 에이전트의 직접 파일 쓰기 등) 폴더가 바뀌었을 때만
   * 호출하면 된다.
   */
  invalidateTree(courseId: string): void
  /** 경로 이탈 가드를 거친 절대 경로. 네이티브 파일 드래그(startDrag)용. */
  absolutePathFor(courseId: string, relPath: string): string
  /** `dirRelPath` ''/생략 = 과목 폴더 루트. */
  import(courseId: string, paths: string[], dirRelPath?: string): ImportResult
  /** 파일/폴더를 다른 과목-상대 디렉터리로 옮긴다 ('' = 루트). */
  move(input: {
    courseId: string
    fromRelPath: string
    toDirRelPath: string
  }): { relPath: string }
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
  /** Production uses the exported defaults; tests may lower them. */
  scanLimits?: MaterialsScanLimits
}

export interface MaterialsScanLimits {
  maxDepth: number
  maxEntries: number
}

/**
 * Comparison form for filename search.
 *
 * NFC because macOS stores Korean filenames decomposed (NFD) while IME input
 * produces composed (NFC) — without this, searching a Hangul filename that is
 * visibly right in the tree returns nothing. Never use this for filesystem
 * access; it is a matching key only.
 */
export function searchKey(value: string): string {
  return value.normalize('NFC').toLowerCase()
}

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif', '.heic'
])
// bandal-media:// 스트리밍으로 재생 가능한 컨테이너만. (mediaProtocol.ts)
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.webm'])
const TEXT_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.csv', '.tsv', '.json', '.yml', '.yaml',
  '.xml', '.html', '.css', '.js', '.ts', '.tex', '.log', '.srt', '.vtt'
])
/** Files larger than this are refused by readFile (base64 over IPC). */
const MAX_READ_BYTES = 64 * 1024 * 1024
/** Clipboard payloads are copied over IPC, so cap their decoded size. */
const MAX_WRITE_BYTES = 50 * 1024 * 1024

/**
 * Twelve nested folders covers ordinary course layouts while bounding hostile
 * or accidentally generated directory chains. Root entries are depth zero.
 */
export const MATERIAL_SCAN_MAX_DEPTH = 12
/**
 * Twenty thousand directory entries is well beyond a normal course, but puts
 * a finite ceiling on synchronous main-process filesystem work.
 */
export const MATERIAL_SCAN_MAX_ENTRIES = 20_000

export const MATERIAL_TREE_TRUNCATION_REL_PATH =
  '.bandal/__materials_scan_truncated__'
export const MATERIAL_INDEX_STATE_REL_PATH = '.bandal/__materials_index_state__'

const TRUNCATED_BY_DEPTH = 1
const TRUNCATED_BY_ENTRY_COUNT = 2

type ScanTruncation = 'depth' | 'entries'

interface WalkState {
  entriesRead: number
  files: MaterialNode[]
  limits: MaterialsScanLimits
  truncation: Set<ScanTruncation>
}

interface MaterialWalk {
  nodes: MaterialNode[]
  files: MaterialNode[]
  truncation: Set<ScanTruncation>
}

export function kindForFile(fileName: string): MaterialKind {
  const ext = extname(fileName).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (ext === '.md' || ext === '.markdown') return 'note'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  return 'other'
}

function isHidden(name: string): boolean {
  return name.startsWith('.')
}

function sortedEntries(absDir: string, state: WalkState): Dirent<string>[] {
  if (state.truncation.has('entries')) return []

  const directory = opendirSync(absDir)
  const entries: Dirent<string>[] = []
  try {
    while (true) {
      const entry = directory.readSync()
      if (entry === null) break

      // One look-ahead entry is necessary to distinguish exactly-at-limit
      // from truncated. It is never stat'ed or returned.
      if (state.entriesRead >= state.limits.maxEntries) {
        state.truncation.add('entries')
        break
      }
      state.entriesRead += 1
      // Hidden and special entries still consume the scan budget: otherwise
      // a folder full of them could bypass the main-thread work ceiling.
      if (!isHidden(entry.name)) entries.push(entry)
    }
  } finally {
    directory.closeSync()
  }

  return entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) {
      return a.isDirectory() ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })
}

function walkDir(
  absDir: string,
  relDir: string,
  depth: number,
  state: WalkState
): MaterialNode[] {
  const entries = sortedEntries(absDir, state)
  const nodes: MaterialNode[] = []
  for (const entry of entries) {
    const relPath = relDir === '' ? entry.name : posix.join(relDir, entry.name)
    const absPath = join(absDir, entry.name)
    if (entry.isDirectory()) {
      let children: MaterialNode[] = []
      if (depth >= state.limits.maxDepth) {
        state.truncation.add('depth')
      } else {
        children = walkDir(absPath, relPath, depth + 1, state)
      }
      nodes.push({
        relPath,
        name: entry.name,
        kind: 'dir',
        children
      })
    } else if (entry.isFile()) {
      const stat = statSync(absPath)
      const node: MaterialNode = {
        relPath,
        name: entry.name,
        kind: kindForFile(entry.name),
        size: stat.size,
        mtime: Math.round(stat.mtimeMs)
      }
      nodes.push(node)
      state.files.push(node)
    }
    // Symlinks and other entry types are intentionally skipped.
  }
  return nodes
}

function scanMaterialTree(
  folder: string,
  limits: MaterialsScanLimits
): MaterialWalk {
  const state: WalkState = {
    entriesRead: 0,
    files: [],
    limits,
    truncation: new Set()
  }
  const nodes = walkDir(folder, '', 0, state)
  return { nodes, files: state.files, truncation: state.truncation }
}

function truncationNode(
  truncation: Set<ScanTruncation>,
  limits: MaterialsScanLimits
): MaterialNode {
  const reasons: string[] = []
  if (truncation.has('depth')) {
    reasons.push(`깊이 ${limits.maxDepth}`)
  }
  if (truncation.has('entries')) {
    reasons.push(`엔트리 ${limits.maxEntries.toLocaleString()}개`)
  }
  return {
    relPath: MATERIAL_TREE_TRUNCATION_REL_PATH,
    name: `⚠ 일부 자료만 표시됨 — 스캔 상한(${reasons.join(', ')}) 도달`,
    kind: 'dir',
    children: []
  }
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
  const scanLimits = deps.scanLimits ?? {
    maxDepth: MATERIAL_SCAN_MAX_DEPTH,
    maxEntries: MATERIAL_SCAN_MAX_ENTRIES
  }

  // [perf] 과목 전환마다 폴더 전체를 다시 걷는 동기 스캔이 메인 프로세스
  // 멈춤(비치볼)의 주범이었다. 스캔 결과를 과목별로 캐시하고, 저장소 변이와
  // invalidateTree 호출(watcher 경유)에서만 버린다. materials_index 재구축도
  // 실제 스캔이 일어날 때만 함께 일어난다.
  const treeCache = new Map<string, MaterialNode[]>()

  function requireCourseFolder(courseId: string): { id: string; folder: string } {
    const id = requireId(courseId, 'courseId')
    const folder = getCourseFolder(id)
    if (!existsSync(folder)) {
      throw new NotFoundError('course folder', folder)
    }
    return { id, folder }
  }

  /** Rebuilds materials_index from an already completed tree scan. */
  function rebuildIndex(courseId: string, scan: MaterialWalk): void {
    const now = nowIso()
    const rebuild = db.transaction(() => {
      db.prepare('DELETE FROM materials_index WHERE course_id = ?').run(courseId)
      const insert = db.prepare(
        `INSERT INTO materials_index
           (id, course_id, rel_path, kind, size, mtime, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const truncationFlags =
        (scan.truncation.has('depth') ? TRUNCATED_BY_DEPTH : 0) |
        (scan.truncation.has('entries') ? TRUNCATED_BY_ENTRY_COUNT : 0)
      // A hidden cache-only row distinguishes an indexed empty course from a
      // course that has never been scanned, and carries truncation to dossier.
      insert.run(
        randomUUID(),
        courseId,
        MATERIAL_INDEX_STATE_REL_PATH,
        'other',
        truncationFlags,
        Date.now(),
        now,
        now
      )
      for (const file of scan.files) {
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

  function resolveMaterialAbs(courseId: string, relPath: string): string {
    const { abs } = resolveMaterial(courseId, relPath)
    if (!existsSync(abs)) {
      throw new NotFoundError('material', relPath)
    }
    return abs
  }

  function resolveMaterial(courseId: string, relPath: string): { abs: string; folder: string } {
    const { folder } = requireCourseFolder(courseId)
    const abs = resolveInside(folder, requireNonEmptyString(relPath, 'relPath'))
    return { abs, folder }
  }

  /** 캐시 미스에만 디스크를 걷고 materials_index 를 재구축한다. */
  function cachedTree(courseId: string, folder: string): MaterialNode[] {
    const cached = treeCache.get(courseId)
    if (cached !== undefined) return cached
    const scan = scanMaterialTree(folder, scanLimits)
    rebuildIndex(courseId, scan)
    if (scan.truncation.size > 0) {
      scan.nodes.push(truncationNode(scan.truncation, scanLimits))
    }
    treeCache.set(courseId, scan.nodes)
    return scan.nodes
  }

  return {
    absolutePathFor(courseId, relPath) {
      return resolveMaterialAbs(courseId, relPath)
    },

    invalidateTree(courseId) {
      treeCache.delete(requireId(courseId, 'courseId'))
    },

    tree(courseId) {
      const id = requireId(courseId, 'courseId')
      const folder = getCourseFolder(id)
      if (!existsSync(folder)) {
        // Folder was removed out-of-band; surface an empty tree, not a crash.
        // 캐시도 함께 버린다 — 사라진 폴더의 옛 트리를 계속 보여주면 안 된다.
        console.warn(`[materials] course folder missing on disk: ${folder}`)
        treeCache.delete(id)
        return []
      }
      return cachedTree(id, folder)
    },

    search(courseId, query) {
      const id = requireId(courseId, 'courseId')
      const folder = getCourseFolder(id)
      const needle = searchKey(requireNonEmptyString(query, 'query').trim())
      if (!existsSync(folder)) {
        treeCache.delete(id)
        return []
      }
      // 캐시가 차 있으면 materials_index 는 그 스캔과 일치한다 — 키 입력마다
      // 디스크를 다시 걷지 않는다. 비어 있으면 여기서 한 번만 채운다.
      cachedTree(id, folder)

      // Matching happens in JS, not in SQL, because SQLite's `instr` compares
      // bytes. macOS hands back decomposed (NFD) filenames from readdir while
      // a query typed with a Korean IME arrives composed (NFC), so
      // `instr(lower(rel_path), '과제')` finds nothing for a file the student
      // can plainly see in the tree. Comparing NFC-normalized forms fixes it.
      //
      // The STORED rel_path is deliberately left untouched — it is the
      // filesystem's own spelling, and every read/open path resolves against
      // it. Normalizing what we persist would break opening the very files
      // this makes findable.
      const rows = db
        .prepare(
          `SELECT rel_path, kind FROM materials_index
           WHERE course_id = ?
             AND deleted_at IS NULL
             AND rel_path != ?
           ORDER BY rel_path ASC`
        )
        .all(id, MATERIAL_INDEX_STATE_REL_PATH) as {
          rel_path: string
          kind: MaterialKind
        }[]

      return rows
        .filter((row) => searchKey(row.rel_path).includes(needle))
        .map((row) => {
          const name = posix.basename(row.rel_path)
          const nameKey = searchKey(name)
          let score = 1
          if (nameKey.includes(needle)) score = 2
          if (nameKey.startsWith(needle)) score = 3
          return { relPath: row.rel_path, name, kind: row.kind, score }
        })
        .sort((a, b) => b.score - a.score || a.relPath.localeCompare(b.relPath))
    },

    import(courseId, paths, dirRelPath) {
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
      if (dirRelPath !== undefined && typeof dirRelPath !== 'string') {
        throw new ValidationError('dirRelPath must be a string')
      }
      // '' 또는 생략 = 과목 폴더 루트. 하위 폴더는 존재하는 디렉터리여야 한다.
      const targetDirRel = dirRelPath ?? ''
      const targetDirAbs = resolveInside(folder, targetDirRel, { allowRoot: true })
      if (!existsSync(targetDirAbs) || !lstatSync(targetDirAbs).isDirectory()) {
        throw new NotFoundError('material directory', targetDirRel)
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
          const targetName = unusedTargetName(targetDirAbs, basename(source))
          copyFileSync(source, join(targetDirAbs, targetName))
          imported.push(
            targetDirRel === '' ? targetName : posix.join(targetDirRel, targetName)
          )
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          failed.push({ path: String(sourcePath), reason })
        }
      }
      if (imported.length > 0) treeCache.delete(id)
      return { imported, failed }
    },

    move(input) {
      const { abs: sourceAbs, folder } = resolveMaterial(
        input.courseId,
        input.fromRelPath
      )
      assertFileOrDirectory(sourceAbs, input.fromRelPath)
      if (typeof input.toDirRelPath !== 'string') {
        throw new ValidationError('toDirRelPath must be a string')
      }
      const destDirAbs = resolveInside(folder, input.toDirRelPath, {
        allowRoot: true
      })
      if (!existsSync(destDirAbs) || !lstatSync(destDirAbs).isDirectory()) {
        throw new NotFoundError('material directory', input.toDirRelPath)
      }
      // 폴더를 자기 자신이나 그 하위로 옮기면 파일계가 꼬인다 — 거부한다.
      if (destDirAbs === sourceAbs || destDirAbs.startsWith(sourceAbs + sep)) {
        throw new ValidationError('폴더를 자기 안으로 옮길 수 없습니다')
      }
      const name = posix.basename(input.fromRelPath)
      const parentRelPath = posix.dirname(input.fromRelPath)
      const parentAbs =
        parentRelPath === '.' ? folder : resolveInside(folder, parentRelPath)
      // 같은 폴더로의 이동은 no-op — 충돌 개명이 이름만 바꾸는 사고를 막는다.
      if (parentAbs === destDirAbs) {
        return { relPath: input.fromRelPath }
      }
      const targetName = unusedTargetName(destDirAbs, name)
      const relPath =
        input.toDirRelPath === ''
          ? targetName
          : posix.join(input.toDirRelPath, targetName)
      const destAbs = resolveInside(folder, relPath)
      renameSync(sourceAbs, destAbs)
      treeCache.delete(requireId(input.courseId, 'courseId'))
      return { relPath }
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
      treeCache.delete(requireId(input.courseId, 'courseId'))
      return { relPath: destinationRelPath }
    },

    async softDelete(input) {
      const { abs } = resolveMaterial(input.courseId, input.relPath)
      assertFileOrDirectory(abs, input.relPath)
      await trashItem(abs)
      treeCache.delete(requireId(input.courseId, 'courseId'))
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
      treeCache.delete(requireId(input.courseId, 'courseId'))
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
      treeCache.delete(requireId(input.courseId, 'courseId'))
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
      treeCache.delete(requireId(input.courseId, 'courseId'))
      return { relPath }
    }
  }
}
