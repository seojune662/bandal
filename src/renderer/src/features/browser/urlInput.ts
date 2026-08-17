/**
 * [M3-F] URL-bar input resolution: URL-ish input navigates (https by
 * default), anything else becomes a search-engine query.
 */

import { looksLikeUrl, normalizeUrl } from '../workspace/tabIdentity'

const SEARCH_URL_PREFIX = 'https://www.google.com/search?q='

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
export function resolveAddressInput(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed.length === 0) return null
  if (looksLikeUrl(trimmed)) return normalizeUrl(trimmed)
  return `${SEARCH_URL_PREFIX}${encodeURIComponent(trimmed)}`
}
