/**
 * The home sidebar's site tiles: school essentials, sites the user added and
 * sites they visit often. A direct translation of the iPad app's
 * `NativeHomeSites` (bandal-iPad App/Native/NativeHomeSiteTiles.swift) so both
 * apps rank the same `homeSites` preferences the same way.
 */

export interface HomeSitePreferences {
  /** Site ids, in the order they were pinned. */
  pinned: string[]
  /** Hosts the user removed. */
  hidden: string[]
  custom: { id: string; title: string; url: string }[]
}

export const DEFAULT_HOME_SITES: HomeSitePreferences = { pinned: [], hidden: [], custom: [] }

export type HomeSiteSource = 'school' | 'custom' | 'visited'

export interface HomeSite {
  id: string
  title: string
  url: string
  host: string
  source: HomeSiteSource
  visits: number
  pinned: boolean
  opensExternally: boolean
}

export interface HomeSiteSchoolLink {
  id: string
  label: string
  url: string
  secondary: boolean
  opensExternally: boolean
}

export interface HomeSiteVisit { host: string; title: string; visits: number }

/** A school's essentials: its first links, before the rest earn a place by visits. */
export const HOME_SITE_SCHOOL_LIMIT = 4
/** A site seen this often in the browser joins the tiles on its own. */
export const HOME_SITE_VISITED_THRESHOLD = 3
export const HOME_SITE_LIMIT = 12
const MAX_CUSTOM = 24

export function homeSiteHost(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host === '') return null
    return host.startsWith('www.') ? host.slice(4) : host
  } catch { return null }
}

const stripWww = (host: string): string => host.startsWith('www.') ? host.slice(4) : host

/**
 * Pinned sites first, in pin order; then the rest by visits. Each school link
 * and added site starts with one visit so it holds its place until browsing
 * says otherwise; ties keep the school's order.
 */
export function rankHomeSites(school: readonly HomeSiteSchoolLink[], preferences: HomeSitePreferences, visited: readonly HomeSiteVisit[]): HomeSite[] {
  const visits = new Map<string, number>()
  for (const site of visited) visits.set(stripWww(site.host), (visits.get(stripWww(site.host)) ?? 0) + site.visits)
  const hidden = new Set(preferences.hidden)
  const sites: HomeSite[] = []
  const hosts = new Set<string>()
  const add = (site: HomeSite): void => {
    if (hidden.has(site.host) || sites.some(other => other.id === site.id)) return
    sites.push(site); hosts.add(site.host)
  }
  const essentials = school.map((service, index) => ({ service, index }))
    .sort((a, b) => Number(a.service.secondary) - Number(b.service.secondary) || a.index - b.index)
    .map(entry => entry.service)
  for (const service of essentials.slice(0, HOME_SITE_SCHOOL_LIMIT)) {
    const host = homeSiteHost(service.url)
    if (!host) continue
    add({ id: `school:${service.id}`, title: service.label, url: service.url, host, source: 'school', visits: 1 + (visits.get(host) ?? 0), pinned: false, opensExternally: service.opensExternally })
  }
  for (const custom of preferences.custom) {
    const host = homeSiteHost(custom.url)
    if (!host) continue
    add({ id: custom.id, title: custom.title || host, url: custom.url, host, source: 'custom', visits: 1 + (visits.get(host) ?? 0), pinned: false, opensExternally: false })
  }
  for (const site of visited) {
    const host = stripWww(site.host)
    if (hosts.has(host) || (visits.get(host) ?? 0) < HOME_SITE_VISITED_THRESHOLD) continue
    add({ id: `visited:${host}`, title: site.title || host, url: `https://${site.host}/`, host, source: 'visited', visits: visits.get(host) ?? 0, pinned: false, opensExternally: false })
  }
  const order = new Map(sites.map((site, index) => [site.id, index]))
  for (const site of sites) site.pinned = preferences.pinned.includes(site.id)
  const pinned = preferences.pinned.flatMap(id => sites.filter(site => site.id === id))
  const rest = sites.filter(site => !site.pinned)
    .sort((a, b) => a.visits !== b.visits ? b.visits - a.visits : order.get(a.id)! - order.get(b.id)!)
  return [...pinned, ...rest.slice(0, Math.max(0, HOME_SITE_LIMIT - pinned.length))]
}

/** Browser history rows folded into one count per host. */
export function foldVisits(entries: readonly { host: string; title: string; visitCount: number }[]): HomeSiteVisit[] {
  const byHost = new Map<string, HomeSiteVisit>()
  for (const entry of entries) {
    if (!entry.host) continue
    const host = stripWww(entry.host.toLowerCase())
    const current = byHost.get(host)
    if (current) current.visits += entry.visitCount
    else byHost.set(host, { host, title: entry.title, visits: entry.visitCount })
  }
  return [...byHost.values()].sort((a, b) => b.visits - a.visits)
}

const isText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max

export function sanitizeHomeSites(raw: unknown): HomeSitePreferences {
  if (typeof raw !== 'object' || raw === null) return { pinned: [], hidden: [], custom: [] }
  const record = raw as Record<string, unknown>
  const strings = (value: unknown): string[] => Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => isText(item, 300) && item !== ''))].slice(0, 64)
    : []
  const custom = Array.isArray(record.custom)
    ? record.custom.flatMap(row => {
      if (typeof row !== 'object' || row === null) return []
      const item = row as Record<string, unknown>
      if (!isText(item.id, 80) || !isText(item.url, 2048) || item.id === '') return []
      try {
        const url = new URL(item.url)
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return []
      } catch { return [] }
      return [{ id: item.id, title: isText(item.title, 80) ? item.title : '', url: item.url }]
    }).slice(0, MAX_CUSTOM)
    : []
  return { pinned: strings(record.pinned), hidden: strings(record.hidden), custom }
}

/** Accepts "naver.com" as well as a full address. */
export function normalizeSiteUrl(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed === '') return null
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname.includes('.')) return null
    return url.href
  } catch { return null }
}
