import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { SharedMaterialRequest } from '../../../shared/types/share'
import { writeFileAtomic } from '../../lib/atomicWrite'
import type { ImportResult } from '../../../shared/types/materials'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ITEMS = 100
const MAX_BYTES = 1024 * 1024 * 1024

export function shareRequestId(url: string): string | null {
  try {
    const parsed = new URL(url)
    const match = /^\/inbox\/([^/]+)$/.exec(parsed.pathname)
    return parsed.protocol === 'bandal:' && parsed.hostname === 'share' && !parsed.username && !parsed.password && !parsed.port &&
      !parsed.search && !parsed.hash && match && UUID.test(match[1]!) ? match[1]! : null
  } catch { return null }
}

export function createShareInbox(deps: {
  root: () => string | null
  importFiles: (courseId: string, paths: string[], dirRelPath: string) => ImportResult
  changed: () => void
  journalRoot: string
}) {
  type Progress = { courseId: string; dirRelPath: string; source: string; relPath: string }
  function readProgress(id: string): Progress[] {
    const file = join(deps.journalRoot, `${id}.json`)
    if (!existsSync(file)) return []
    const data: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(data) || data.some(item => !item || typeof item !== 'object' ||
      !['courseId', 'dirRelPath', 'source', 'relPath'].every(key => typeof (item as Record<string, unknown>)[key] === 'string'))) {
      throw new Error('가져오기 진행 기록을 읽지 못했습니다. 공유 자료는 보관되어 있습니다.')
    }
    return data as Progress[]
  }
  function read(id: string): { request: SharedMaterialRequest; paths: string[]; directory: string } {
    if (typeof id !== 'string' || !UUID.test(id)) throw new Error('올바르지 않은 공유 요청입니다.')
    const root = deps.root()
    if (!root) throw new Error('이 환경에서는 공유 받은 자료를 사용할 수 없습니다.')
    const directory = join(root, id)
    if (lstatSync(root).isSymbolicLink() || lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) throw new Error('공유 요청의 위치가 올바르지 않습니다.')
    const canonicalRoot = realpathSync(root)
    if (realpathSync(directory) !== join(canonicalRoot, id)) throw new Error('공유 요청의 위치가 올바르지 않습니다.')
    const manifest = join(directory, 'manifest.json')
    if (!lstatSync(manifest).isFile() || lstatSync(manifest).isSymbolicLink() || lstatSync(manifest).size > 64 * 1024) throw new Error('공유 요청을 읽을 수 없습니다.')
    const value: unknown = JSON.parse(readFileSync(manifest, 'utf8'))
    if (!value || typeof value !== 'object') throw new Error('공유 요청 형식이 올바르지 않습니다.')
    const data = value as Record<string, unknown>
    if (data.version !== 1 || data.id !== id || typeof data.createdAt !== 'string' || !Number.isFinite(Date.parse(data.createdAt)) || !Array.isArray(data.files) || data.files.length < 1 || data.files.length > MAX_ITEMS) throw new Error('공유 요청 형식이 올바르지 않습니다.')
    let total = 0
    const seen = new Set<string>()
    const files = data.files.map((name: unknown) => {
      if (typeof name !== 'string' || !name || name === '.' || name === '..' || name === 'manifest.json' || name.includes('\\') || name.includes('\0') || basename(name) !== name || seen.has(name)) throw new Error('공유 파일 이름이 올바르지 않습니다.')
      seen.add(name)
      const file = join(directory, name)
      const info = lstatSync(file)
      if (info.isSymbolicLink() || !info.isFile() || realpathSync(file) !== resolve(canonicalRoot, id, name)) throw new Error('공유 파일의 위치가 올바르지 않습니다.')
      total += info.size
      if (total > MAX_BYTES) throw new Error('한 번에 1GB까지 가져올 수 있습니다.')
      return { name, size: info.size }
    })
    return { request: { id, createdAt: data.createdAt, files }, paths: files.map(file => join(directory, file.name)), directory }
  }
  function list(): SharedMaterialRequest[] {
    const root = deps.root()
    if (!root || !existsSync(root)) return []
    return readdirSync(root).filter(id => UUID.test(id)).slice(0, 100).flatMap(id => {
      try { return [read(id).request] } catch { return [] }
    }).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
  return {
    list,
    receive(url: string): boolean {
      const id = shareRequestId(url)
      if (!id) return false
      // An unavailable/invalid delivery must never crash app startup.
      try { read(id); deps.changed() } catch (error) { console.warn('[share] delivery unavailable', error) }
      return true
    },
    import(input: { id: string; courseId: string; dirRelPath: string }): { relPaths: string[] } {
      const delivery = read(input.id)
      // Journal successful copies in the current profile, so a failed multi-file
      // delivery remains retryable after a crash or app restart without duplicates.
      const progress = readProgress(input.id)
      const completed = new Map(progress.filter(item => item.courseId === input.courseId && item.dirRelPath === input.dirRelPath).map(item => [item.source, item.relPath]))
      const paths = delivery.paths.filter(file => !completed.has(file))
      mkdirSync(deps.journalRoot, { recursive: true, mode: 0o700 })
      for (const file of paths) {
        const result = deps.importFiles(input.courseId, [file], input.dirRelPath)
        const relPath = result.imported[0]
        if (relPath) {
          completed.set(file, relPath)
          progress.push({ courseId: input.courseId, dirRelPath: input.dirRelPath, source: file, relPath })
          writeFileAtomic(join(deps.journalRoot, `${input.id}.json`), JSON.stringify(progress), { mode: 0o600 })
        }
        if (result.failed.length > 0 || !relPath) throw new Error('자료를 가져오지 못했습니다. 다시 시도해 주세요.')
      }
      rmSync(delivery.directory, { recursive: true })
      rmSync(join(deps.journalRoot, `${input.id}.json`), { force: true })
      deps.changed()
      return { relPaths: [...completed.values()] }
    },
    dismiss(id: string): void {
      const delivery = read(id)
      rmSync(delivery.directory, { recursive: true })
      rmSync(join(deps.journalRoot, `${id}.json`), { force: true })
      deps.changed()
    }
  }
}
