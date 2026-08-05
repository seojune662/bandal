/**
 * The university preset catalog — a static, app-versioned module.
 *
 * Not a DB table on purpose (docs/university-sites.md §6): university URLs
 * rot on a 1–2 year cycle (SNU eTL moved Moodle → Canvas, 고려대 dropped
 * Blackboard), and shipping a fixed URL with the app beats migrating rows.
 * User-owned data (chosen school, hidden services, custom entries, per-course
 * links) lives in settings / SQLite and always wins.
 *
 * Never change a `University.id` or a `UniversityService.id` — settings
 * reference them by string. Fix the URL, keep the id.
 */

import type {
  ServiceKind,
  University,
  UniversityService,
  UniversitySettings
} from '../types/university'
import { REGIONAL_UNIVERSITIES } from './regional'
import { SEOUL_PRIVATE_UNIVERSITIES } from './seoulPrivate'
import { SNU, VERIFIED_AT } from './snu'

export { VERIFIED_AT as CATALOG_VERIFIED_AT }
export * from './courseLink'
export {
  blackboardCourseLink,
  canvasCourseLink,
  ilosCourseLink,
  moodleCourseLink
} from './specs'

/** 18 schools verified on 2026-08-05, 서울대 first (the reference entry). */
export const UNIVERSITIES: readonly University[] = [
  SNU,
  ...SEOUL_PRIVATE_UNIVERSITIES,
  ...REGIONAL_UNIVERSITIES
]

/** Prefix that marks a user-defined school (`custom:<uuid>`). */
export const CUSTOM_UNIVERSITY_PREFIX = 'custom:'

export function isCustomUniversityId(id: string | null): boolean {
  return id !== null && id.startsWith(CUSTOM_UNIVERSITY_PREFIX)
}

export function findUniversity(id: string | null | undefined): University | null {
  if (id === null || id === undefined) return null
  return UNIVERSITIES.find((university) => university.id === id) ?? null
}

/**
 * The school currently in effect: a preset, or the user's custom definition.
 * Returns null while onboarding has not asked yet.
 */
export function resolveUniversity(
  settings: UniversitySettings | null | undefined
): University | null {
  if (settings === null || settings === undefined) return null
  const { universityId, customUniversity } = settings
  if (universityId === null) return null
  if (isCustomUniversityId(universityId)) {
    return customUniversity !== null && customUniversity.id === universityId
      ? customUniversity
      : null
  }
  return findUniversity(universityId)
}

function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase().replace(/\s+/g, '')
}

/** Onboarding search: name (ko/en) + aliases + domain, whitespace-insensitive. */
export function searchUniversities(query: string): readonly University[] {
  const normalized = normalizeQuery(query)
  if (normalized.length === 0) return UNIVERSITIES
  return UNIVERSITIES.filter((university) =>
    [
      university.nameKo,
      university.nameEn,
      university.domain,
      ...university.aliases
    ].some((term) => normalizeQuery(term).includes(normalized))
  )
}

/** A preset/custom service with the user's overrides already applied. */
export interface ResolvedService extends UniversityService {
  /** Final embedded-vs-external decision (override beats the preset). */
  opensExternally: boolean
  /** True for entries the user added themselves. */
  isCustom: boolean
}

function applyOverride(
  service: UniversityService,
  overrides: Readonly<Record<string, boolean>>,
  isCustom: boolean
): ResolvedService {
  const override = overrides[service.id]
  return {
    ...service,
    opensExternally: override ?? service.opensExternally ?? false,
    isCustom
  }
}

/**
 * The sidebar's list: preset services first (catalog order), then the user's
 * own, minus anything hidden, with per-service external overrides applied.
 */
export function resolveServices(
  university: University | null,
  settings: UniversitySettings | null | undefined
): readonly ResolvedService[] {
  const hidden = new Set(settings?.hiddenServiceIds ?? [])
  const overrides = settings?.openExternallyOverrides ?? {}
  const presets = (university?.services ?? []).map((service) =>
    applyOverride(service, overrides, false)
  )
  const custom = (settings?.customServices ?? []).map((service) =>
    applyOverride(service, overrides, true)
  )
  return [...presets, ...custom].filter((service) => !hidden.has(service.id))
}

const KIND_LABELS: Readonly<Record<ServiceKind, string>> = {
  portal: '학사·포털',
  lms: '강의',
  registration: '수강신청',
  library: '도서관',
  mail: '메일',
  homepage: '홈페이지',
  other: '그 밖에'
}

export function serviceKindLabel(kind: ServiceKind): string {
  return KIND_LABELS[kind]
}
