import { MATERIAL_MOVE_MIME } from './materialMoveDrag'

function firstUri(value: string): string {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith('#')) ?? ''
  )
}

function httpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

export function canAcceptUrlDrop(types: readonly string[]): boolean {
  const typeSet = new Set(types)
  if (typeSet.has(MATERIAL_MOVE_MIME) || typeSet.has('Files')) return false
  return typeSet.has('text/uri-list') || typeSet.has('text/plain')
}

export function urlFromDrop(dataTransfer: DataTransfer): string | null {
  const uri = firstUri(dataTransfer.getData('text/uri-list'))
  if (uri.length > 0) {
    const url = httpUrl(uri)
    if (url !== null) return url
  }
  return httpUrl(dataTransfer.getData('text/plain').trim())
}
