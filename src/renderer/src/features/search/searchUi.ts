import type { MaterialKind } from '../../../../shared/types/materials'
import type {
  SearchHit,
  SearchHitKind
} from '../../../../shared/types/search'

export interface ContentSearchShortcutInput {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  isComposing: boolean
}

export interface SnippetSegment {
  text: string
  matched: boolean
}

/** Standard IDE "Find in Files" chord, with the same IME guard as ⌘P. */
export function isContentSearchShortcut(
  input: ContentSearchShortcutInput
): boolean {
  return (
    !input.isComposing &&
    (input.metaKey || input.ctrlKey) &&
    input.shiftKey &&
    !input.altKey &&
    input.key.toLowerCase() === 'f'
  )
}

export function fileNameFromRelPath(relPath: string): string {
  return relPath.split('/').pop() ?? relPath
}

export function materialKindForSearchHit(kind: SearchHitKind): MaterialKind {
  return kind === 'text' ? 'other' : kind
}

/** Produces safe React-ready text pieces; no HTML injection is involved. */
export function snippetSegments(snippet: string, query: string): SnippetSegment[] {
  const normalizedSnippet = snippet.normalize('NFC')
  const needle = query.trim().normalize('NFC').toLowerCase()
  if (needle.length === 0) return [{ text: normalizedSnippet, matched: false }]

  const key = normalizedSnippet.toLowerCase()
  const segments: SnippetSegment[] = []
  let from = 0
  while (from < normalizedSnippet.length) {
    const matchAt = key.indexOf(needle, from)
    if (matchAt < 0) break
    if (matchAt > from) {
      segments.push({
        text: normalizedSnippet.slice(from, matchAt),
        matched: false
      })
    }
    segments.push({
      text: normalizedSnippet.slice(matchAt, matchAt + needle.length),
      matched: true
    })
    from = matchAt + needle.length
  }
  if (from < normalizedSnippet.length) {
    segments.push({ text: normalizedSnippet.slice(from), matched: false })
  }
  return segments.length > 0
    ? segments
    : [{ text: normalizedSnippet, matched: false }]
}

export function searchHitKey(hit: SearchHit): string {
  return `${hit.kind}:${hit.relPath}:${hit.page ?? 'file'}`
}
