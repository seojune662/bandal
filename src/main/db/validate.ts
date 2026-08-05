/**
 * Boundary validation helpers shared by all repos.
 *
 * Fail fast with typed errors (see ./errors) so bad renderer input never
 * reaches SQL or the filesystem.
 */

import { isAbsolute, relative, resolve, sep } from 'node:path'
import { PathTraversalError, ValidationError } from './errors'

/** Asserts `value` is a non-empty string (after trim) and returns it. */
export function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${field} must be a non-empty string`)
  }
  return value
}

/** Asserts `value` looks like an id (non-empty string, no control chars). */
export function requireId(value: unknown, field: string): string {
  const id = requireNonEmptyString(value, field)
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(id)) {
    throw new ValidationError(`${field} contains control characters`)
  }
  return id.trim()
}

/** Asserts `value` is a finite integer >= min. */
export function requireInt(value: unknown, field: string, min: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new ValidationError(`${field} must be an integer >= ${min}`)
  }
  return value
}

/**
 * Resolves `relPath` inside `rootDir` and asserts the result does not
 * escape the root (path-traversal guard). Returns the absolute path.
 *
 * Rejects absolute relPaths, `..` segments that climb out of the root and
 * null bytes. `relPath === ''` resolves to the root itself when
 * `allowRoot` is true.
 */
export function resolveInside(
  rootDir: string,
  relPath: string,
  options: { allowRoot?: boolean } = {}
): string {
  if (typeof relPath !== 'string') {
    throw new ValidationError('relPath must be a string')
  }
  if (relPath.includes('\u0000')) {
    throw new PathTraversalError(relPath)
  }
  if (relPath === '') {
    if (options.allowRoot === true) {
      return resolve(rootDir)
    }
    throw new ValidationError('relPath must be a non-empty string')
  }
  if (isAbsolute(relPath)) {
    throw new PathTraversalError(relPath)
  }
  const root = resolve(rootDir)
  const target = resolve(root, relPath)
  const rel = relative(root, target)
  if (rel === '' && options.allowRoot !== true) {
    throw new PathTraversalError(relPath)
  }
  if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
    throw new PathTraversalError(relPath)
  }
  return target
}

/** Current timestamp in the ISO-8601 format used by every table. */
export function nowIso(): string {
  return new Date().toISOString()
}
