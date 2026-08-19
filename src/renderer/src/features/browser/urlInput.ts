/**
 * [M3-F] URL-bar input resolution: URL-ish input navigates (https by
 * default), anything else becomes a search-engine query.
 */

import { looksLikeUrl, normalizeUrl } from '../workspace/tabIdentity'

import {
  DEFAULT_SEARCH_ENGINE,
  SEARCH_ENGINES,
  type SearchEngineId
} from '../../../../shared/search'

export { DEFAULT_SEARCH_ENGINE, SEARCH_ENGINES }
export type { SearchEngineId }

export interface AddressDisplayParts {
  prefix: string
  domain: string
  suffix: string
  secure: boolean
}

/**
 * 표시 전용 주소 정리 — Safari/Chrome 문법을 따른다. 실제 URL 은 그대로
 * 두고(포커스하면 원문 편집), 보이는 것만 바꾼다:
 * - 퍼센트 인코딩을 디코드한다. 한글 경로가 %EC%84%9C… 로 보이면 주소가
 *   실제보다 훨씬 복잡해 보인다.
 * - https:// 스킴과 www. 접두는 숨긴다(http 는 경고 신호라 남긴다).
 * - 루트 경로의 맨끝 '/' 는 지운다.
 */
export function addressDisplayParts(url: string): AddressDisplayParts {
  try {
    const parsed = new URL(url)
    if (parsed.host.length === 0) throw new Error('No URL host')
    const secure = parsed.protocol === 'https:'
    const decode = (part: string): string => {
      try {
        return decodeURI(part)
      } catch {
        return part
      }
    }
    let suffix = decode(`${parsed.pathname}${parsed.search}${parsed.hash}`)
    if (suffix === '/') suffix = ''
    return {
      prefix: secure ? '' : `${parsed.protocol}//`,
      domain: decode(parsed.host.replace(/^www\./iu, '')),
      suffix,
      secure
    }
  } catch {
    return { prefix: '', domain: url, suffix: '', secure: false }
  }
}

/** Resolve raw URL-bar input to a loadable URL; null for empty input. */
export function resolveAddressInput(
  input: string,
  engine: SearchEngineId = DEFAULT_SEARCH_ENGINE
): string | null {
  const trimmed = input.trim()
  if (trimmed.length === 0) return null
  if (looksLikeUrl(trimmed)) return normalizeUrl(trimmed)
  const prefix = SEARCH_ENGINES[engine] ?? SEARCH_ENGINES[DEFAULT_SEARCH_ENGINE]
  return `${prefix}${encodeURIComponent(trimmed)}`
}

export type SuggestionKind = 'url' | 'search' | 'history' | 'favorite' | 'tab'

export interface AddressSuggestion {
  kind: SuggestionKind
  /** What navigating to this suggestion loads. */
  url: string
  /** Primary line: a title when we have one, else the URL. */
  label: string
  /** Secondary line: the URL, or empty when the label already is it. */
  detail: string
}

export interface SuggestionSources {
  history: ReadonlyArray<{ url: string; title: string; host: string }>
  favorites: ReadonlyArray<{ label: string; url: string }>
  /** School shortcuts — the student's own campus, so they rank like favorites. */
  services: ReadonlyArray<{ label: string; url: string }>
  openTabs: ReadonlyArray<{ title: string; url: string }>
}

const MAX_SUGGESTIONS = 8

function hostPrefixScore(host: string, query: string): number {
  const bare = host.replace(/^www\./i, '').toLowerCase()
  if (bare.startsWith(query)) return 0
  if (bare.includes(query)) return 1
  return 2
}

/**
 * What the omnibox offers for `input`.
 *
 * Ordering is the whole feature: the literal interpretation of what was typed
 * comes first (so ↵ never surprises), then things the student already chose —
 * open tabs, favorites, school services — then history, then a web search as
 * the fallback. Within history, a host being typed beats raw frequency.
 */
export function suggestionsFor(
  input: string,
  sources: SuggestionSources,
  engine: SearchEngineId = DEFAULT_SEARCH_ENGINE
): AddressSuggestion[] {
  const trimmed = input.trim()
  if (trimmed === '') return []
  const query = trimmed.toLowerCase()
  const out: AddressSuggestion[] = []
  const seen = new Set<string>()

  const push = (suggestion: AddressSuggestion): void => {
    if (seen.has(suggestion.url)) return
    seen.add(suggestion.url)
    out.push(suggestion)
  }

  // 1. Exactly what was typed, read literally. Always first so ↵ is predictable.
  if (looksLikeUrl(trimmed)) {
    const url = normalizeUrl(trimmed)
    push({ kind: 'url', url, label: url, detail: '' })
  }

  const matches = (label: string, url: string): boolean =>
    label.toLowerCase().includes(query) || url.toLowerCase().includes(query)

  // 2. Things the student already picked, most specific first.
  for (const tab of sources.openTabs) {
    if (matches(tab.title, tab.url)) {
      push({ kind: 'tab', url: tab.url, label: tab.title, detail: tab.url })
    }
  }
  for (const favorite of sources.favorites) {
    if (matches(favorite.label, favorite.url)) {
      push({
        kind: 'favorite',
        url: favorite.url,
        label: favorite.label,
        detail: favorite.url
      })
    }
  }
  for (const service of sources.services) {
    if (matches(service.label, service.url)) {
      push({
        kind: 'favorite',
        url: service.url,
        label: service.label,
        detail: service.url
      })
    }
  }

  // 3. History, already ranked by the repo but re-sorted so a host being
  //    typed floats above a merely frequent page.
  const ranked = [...sources.history].sort(
    (a, b) => hostPrefixScore(a.host, query) - hostPrefixScore(b.host, query)
  )
  for (const entry of ranked) {
    push({
      kind: 'history',
      url: entry.url,
      label: entry.title === '' ? entry.url : entry.title,
      detail: entry.url
    })
  }

  // 4. Web search is always reachable, even when everything else matched.
  const searchUrl = resolveAddressInput(trimmed, engine)
  if (searchUrl !== null && !looksLikeUrl(trimmed)) {
    push({
      kind: 'search',
      url: searchUrl,
      label: trimmed,
      detail: '웹에서 검색'
    })
  }

  return out.slice(0, MAX_SUGGESTIONS)
}
