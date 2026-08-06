/**
 * Pure tab-identity helpers for the workspace.
 *
 * A tab's dockview panel id doubles as its identity key: opening the same
 * logical tab twice (e.g. the same PDF) resolves to the same panel id, so
 * `openTab` can focus the existing panel instead of duplicating it.
 * Everything in this module is side-effect free and unit-testable.
 */

import type {
  TabDescriptor,
  TabKind,
  TabPayloadMap
} from '../../../../shared/tabs'
// Re-exported so existing renderer imports keep working; the validator itself
// now lives in shared/ because main validates descriptors too (favorites).
export { TAB_KINDS, isTabKind, isTabDescriptor } from '../../../../shared/tabs'

/**
 * Identity key == dockview panel id. Two descriptors that should share a
 * tab produce the same key:
 *  - pdf/note: same course + same file
 *  - chat: singleton per course
 *  - board: global singleton
 *  - browser: keyed by its stable tabId (every new browser tab is unique)
 *  - group-chat: singleton per remote group (falls out of the id shape)
 */
export function tabPanelId(descriptor: TabDescriptor): string {
  switch (descriptor.kind) {
    case 'pdf':
    case 'note':
      return `${descriptor.kind}:${descriptor.payload.courseId}:${descriptor.payload.relPath}`
    case 'browser':
      return `browser:${descriptor.payload.tabId}`
    case 'chat':
      return `chat:${descriptor.payload.courseId}`
    case 'board':
      return 'board'
    case 'group-chat':
      return `group-chat:${descriptor.payload.groupId}`
  }
}

function baseName(relPath: string): string {
  const segments = relPath.split('/')
  return segments[segments.length - 1] ?? relPath
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/** Default tab title derived from the payload. */
export function tabTitle(descriptor: TabDescriptor): string {
  switch (descriptor.kind) {
    case 'pdf':
      return baseName(descriptor.payload.relPath)
    case 'note':
      return stripExtension(baseName(descriptor.payload.relPath))
    case 'browser': {
      const host = hostnameOf(descriptor.payload.initialUrl)
      return host ?? '브라우저'
    }
    case 'chat':
      return 'AI 튜터'
    case 'board':
      return '학업 보드'
    case 'group-chat':
      // Pure by contract, so the group's cached name is NOT read here.
      // GroupChatTab renames the panel once the local cache resolves.
      return '그룹 채팅'
  }
}

/** One-line payload summary shown inside M2 placeholder panels. */
export function tabPayloadSummary(descriptor: TabDescriptor): string {
  switch (descriptor.kind) {
    case 'pdf':
    case 'note':
      return descriptor.payload.relPath
    case 'browser':
      return descriptor.payload.initialUrl
    case 'chat':
      return `과목 ${descriptor.payload.courseId}`
    case 'board':
      return '모든 과목의 할 일'
    case 'group-chat':
      return `그룹 ${descriptor.payload.groupId}`
  }
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

// -- "+" omnibox helpers ------------------------------------------------------

const URL_WITH_SCHEME = /^https?:\/\/\S+$/i
const BARE_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/\S*)?$/i

/** Does omnibox input look like something a browser tab should open? */
export function looksLikeUrl(input: string): boolean {
  const trimmed = input.trim()
  if (trimmed.length === 0 || /\s/.test(trimmed)) return false
  return URL_WITH_SCHEME.test(trimmed) || BARE_DOMAIN.test(trimmed)
}

/** Normalize omnibox input into a loadable URL (assumes looksLikeUrl). */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  return URL_WITH_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`
}

/** Descriptor payload helper kept here so callers avoid casts. */
export function descriptorFor<K extends TabKind>(
  kind: K,
  payload: TabPayloadMap[K]
): TabDescriptor {
  return { kind, payload } as TabDescriptor
}
