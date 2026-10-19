import { randomUUID } from 'node:crypto'
import { lstatSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, sep } from 'node:path'
import { materialKindForPath } from '../../../shared/materialKind'
import type { ExternalSourceEntry, ExternalSourceLocation } from '../../../shared/types/externalSources'

const MAX_ENTRIES = 300
interface GrantedEntry { path: string; root: string; kind: 'folder' | 'photos' }

/** Only chooser-granted directories and picker-exported images are browsable. */
export function createExternalSourceLibrary() {
  const entries = new Map<string, GrantedEntry>()
  const ids = new Map<string, string>()
  let folderRoot: string | null = null
  let photoPaths: string[] = []

  function grant(path: string, root: string, kind: GrantedEntry['kind']): string {
    const key = `${kind}:${root}:${path}`
    const previous = ids.get(key)
    if (previous) return previous
    const id = randomUUID()
    entries.set(id, { path, root, kind })
    ids.set(key, id)
    return id
  }
  function forget(kind: GrantedEntry['kind']): void {
    for (const [id, entry] of entries) if (entry.kind === kind) entries.delete(id)
    for (const key of ids.keys()) if (key.startsWith(`${kind}:`)) ids.delete(key)
  }
  function pathFor(id: string): string {
    const entry = entries.get(id)
    if (!entry) throw new Error('연결한 자료를 다시 선택해 주세요.')
    const actual = realpathSync(entry.path)
    const inside = relative(entry.root, actual)
    if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`) || (entry.kind === 'photos' && !photoPaths.includes(actual))) {
      throw new Error('연결한 폴더 밖의 자료는 열 수 없습니다.')
    }
    return actual
  }
  function fileEntry(path: string, root: string, kind: GrantedEntry['kind']): ExternalSourceEntry {
    const stat = lstatSync(path)
    return { id: grant(path, root, kind), name: basename(path), kind: stat.isDirectory() ? 'dir' : materialKindForPath(path), ...(stat.isFile() ? { size: stat.size } : {}) }
  }
  function list(id: string): ExternalSourceLocation {
    const entry = entries.get(id)
    if (!entry || entry.kind !== 'folder') throw new Error('폴더를 다시 연결해 주세요.')
    const path = pathFor(id)
    if (!statSync(path).isDirectory()) throw new Error('폴더를 선택해 주세요.')
    const children = readdirSync(path, { withFileTypes: true })
      .filter(child => !child.name.startsWith('.') && !child.isSymbolicLink() && (child.isDirectory() || child.isFile()))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, 'ko', { numeric: true }))
    return { id, label: basename(path), kind: 'folder', parentId: path === entry.root ? null : grant(dirname(path), entry.root, 'folder'),
      entries: children.slice(0, MAX_ENTRIES).flatMap(child => {
        try { return [fileEntry(`${path}${sep}${child.name}`, entry.root, 'folder')] } catch { return [] }
      }), truncated: children.length > MAX_ENTRIES }
  }
  return {
    pathFor,
    list,
    connectFolder(path: string): ExternalSourceLocation {
      const resolved = realpathSync(path)
      if (!statSync(resolved).isDirectory()) throw new Error('폴더를 선택해 주세요.')
      forget('folder')
      folderRoot = resolved
      return list(grant(folderRoot, folderRoot, 'folder'))
    },
    connectPhotos(paths: string[]): ExternalSourceLocation {
      forget('photos')
      photoPaths = paths.slice(0, 100).map(path => realpathSync(path)).filter(path => statSync(path).isFile())
      return { id: 'photos', label: '선택한 사진', kind: 'photos', parentId: null,
        entries: photoPaths.map(path => fileEntry(path, dirname(path), 'photos')), truncated: paths.length > 100 }
    },
    disconnect(): void { entries.clear(); ids.clear(); folderRoot = null; photoPaths = [] }
  }
}
