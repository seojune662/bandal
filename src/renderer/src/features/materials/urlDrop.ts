import { urlFromDataTransfer } from '../browser/urlDrop'
import { MATERIAL_MOVE_MIME } from './materialMoveDrag'

/**
 * Link drops onto the materials tree. Google Drive (and other Chrome-based
 * drag-outs) carry `DownloadURL` / `text/html` instead of `text/uri-list`,
 * so the accept check and the parser both go through the shared reader.
 */
const URL_TYPES = ['text/uri-list', 'DownloadURL', 'text/html', 'text/plain']

export function canAcceptUrlDrop(types: readonly string[]): boolean {
  const typeSet = new Set(types)
  if (typeSet.has(MATERIAL_MOVE_MIME) || typeSet.has('Files')) return false
  return URL_TYPES.some((type) => typeSet.has(type))
}

export function urlFromDrop(dataTransfer: DataTransfer): string | null {
  return (
    urlFromDataTransfer(Array.from(dataTransfer.types), (type) =>
      dataTransfer.getData(type)
    )?.url ?? null
  )
}
