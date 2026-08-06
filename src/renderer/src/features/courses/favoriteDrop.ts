import { v4 as uuidv4 } from 'uuid'
import type { TabDescriptor } from '../../../../shared/tabs'
import { isTabDescriptor } from '../workspace/tabIdentity'

/** Shared with tab-strip/material-tree drag sources. */
export const FAVORITE_TAB_MIME = 'application/x-bandal-tab'

/** Private MIME used when an existing favorite is dragged to reorder it. */
export const FAVORITE_ITEM_MIME = 'application/x-bandal-favorite-id'

export type FavoriteDragPayload =
  | { version: 1; descriptor: TabDescriptor }
  | {
      version: 1
      material: { courseId: string; relPath: string }
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function materialDescriptor(
  courseId: string,
  relPath: string
): TabDescriptor | null {
  const extension = relPath.includes('.')
    ? relPath.slice(relPath.lastIndexOf('.')).toLocaleLowerCase()
    : ''
  if (extension === '.pdf') {
    return { kind: 'pdf', payload: { courseId, relPath } }
  }
  if (extension === '.md' || extension === '.markdown') {
    return { kind: 'note', payload: { courseId, relPath } }
  }
  return null
}

export function serializeFavoriteTabDrag(descriptor: TabDescriptor): string {
  return JSON.stringify({ version: 1, descriptor } satisfies FavoriteDragPayload)
}

export function serializeFavoriteMaterialDrag(
  courseId: string,
  relPath: string
): string {
  return JSON.stringify({
    version: 1,
    material: { courseId, relPath }
  } satisfies FavoriteDragPayload)
}

/** Parses the canonical custom-MIME payload. Never throws on hostile data. */
export function parseFavoriteDragPayload(raw: string): TabDescriptor | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || value['version'] !== 1) return null
    if (isTabDescriptor(value['descriptor'])) return value['descriptor']

    const material = value['material']
    if (
      !isRecord(material) ||
      !nonEmptyString(material['courseId']) ||
      !nonEmptyString(material['relPath'])
    ) {
      return null
    }
    return materialDescriptor(
      material['courseId'].trim(),
      material['relPath']
    )
  } catch {
    return null
  }
}

function firstUri(value: string): string {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith('#')) ?? ''
  )
}

export function descriptorFromExternalUrl(raw: string): TabDescriptor | null {
  const candidate = firstUri(raw)
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return {
      kind: 'browser',
      payload: { tabId: uuidv4(), initialUrl: url.toString() }
    }
  } catch {
    return null
  }
}

export function canAcceptFavoriteDrop(dataTransfer: DataTransfer): boolean {
  const types = new Set([...dataTransfer.types])
  return (
    types.has(FAVORITE_TAB_MIME) ||
    types.has(FAVORITE_ITEM_MIME) ||
    types.has('text/uri-list') ||
    types.has('text/plain')
  )
}

/** Reads custom Bandal data first, then an external browser URL fallback. */
export function descriptorFromDrop(
  dataTransfer: DataTransfer
): TabDescriptor | null {
  const custom = dataTransfer.getData(FAVORITE_TAB_MIME)
  if (custom.length > 0) {
    const descriptor = parseFavoriteDragPayload(custom)
    if (descriptor !== null) return descriptor
  }

  const uri = dataTransfer.getData('text/uri-list')
  if (uri.length > 0) {
    const descriptor = descriptorFromExternalUrl(uri)
    if (descriptor !== null) return descriptor
  }
  return descriptorFromExternalUrl(dataTransfer.getData('text/plain'))
}

export function moveFavoriteBefore(
  ids: readonly string[],
  sourceId: string,
  targetId: string
): string[] {
  if (sourceId === targetId || !ids.includes(sourceId) || !ids.includes(targetId)) {
    return [...ids]
  }
  const reordered = ids.filter((id) => id !== sourceId)
  const targetIndex = reordered.indexOf(targetId)
  reordered.splice(targetIndex, 0, sourceId)
  return reordered
}

export function moveFavoriteToEnd(
  ids: readonly string[],
  sourceId: string
): string[] {
  if (!ids.includes(sourceId)) return [...ids]
  return [...ids.filter((id) => id !== sourceId), sourceId]
}
