import { isAbsolute, relative, resolve, dirname } from 'node:path'
import { realpathSync, existsSync } from 'node:fs'
function canonical(path: string): string {
  if (existsSync(path)) return realpathSync(path)
  const parent = dirname(path)
  if (parent === path) return path
  return resolve(canonical(parent), relative(parent, path))
}
import type { AiAccessPolicy } from '../../../shared/types/aiAccess'
/** Conservative structural classification. Unknown tools still ask. */
export function cliPermissionAllowed(policy: AiAccessPolicy, tool: string, input: unknown, folder: string): boolean {
  if (policy.mode === 'ask' || !policy.scope.course) return false
  if (!['Read', 'Glob', 'Grep', 'read_file', 'read_many_files', 'glob', 'search_file_content', 'Write', 'Edit', 'write_file', 'replace', 'fileChange'].includes(tool)) return false
  const data = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const paths = [data.file_path, data.path, data.absolute_path, ...(Array.isArray(data.paths) ? data.paths : [])].filter((p): p is string => typeof p === 'string')
  if (!paths.length) return false
  const inside = paths.every(path => { const r = relative(canonical(folder), canonical(isAbsolute(path) ? path : resolve(folder, path))); return !r.startsWith('..') && !isAbsolute(r) })
  if (!inside) return false
  return policy.mode === 'full' || ['Read', 'Glob', 'Grep', 'read_file', 'read_many_files', 'glob', 'search_file_content'].includes(tool)
}

/** Correlate repeated denied actions even when a provider assigns fresh transport IDs. */
export function permissionFingerprint(input: unknown): string {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).filter(([key]) => !['requestId', 'threadId', 'turnId', 'itemId', 'toolCallId', 'reason'].includes(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, normalize(value)]))
  }
  return JSON.stringify(normalize(input)) ?? ''
}
