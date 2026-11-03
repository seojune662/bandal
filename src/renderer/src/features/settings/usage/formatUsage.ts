const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const MONTH_MS = 30 * DAY_MS
const YEAR_MS = 365 * DAY_MS

/** `useT()`'s translator; the units below are i18n keys under settings.usage. */
export type UsageTranslate = (key: string, vars?: Record<string, string | number>) => string

export function formatTokens(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0
  }).format(Math.max(0, value))
}

export function formatDuration(milliseconds: number, t: UsageTranslate): string {
  const totalMinutes = Math.floor(Math.max(0, milliseconds) / MINUTE_MS)
  if (totalMinutes === 0) return '—'

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return t('settings.usage.duration.minutes', { minutes })
  return minutes === 0
    ? t('settings.usage.duration.hours', { hours })
    : t('settings.usage.duration.hoursMinutes', { hours, minutes })
}

export function formatRelative(iso: string, now: Date | number, t: UsageTranslate): string {
  const timestamp = new Date(iso).getTime()
  const nowMs = now instanceof Date ? now.getTime() : now
  if (!Number.isFinite(timestamp) || !Number.isFinite(nowMs)) return '—'

  const elapsed = Math.max(0, nowMs - timestamp)
  if (elapsed < MINUTE_MS) return t('settings.usage.relative.now')
  if (elapsed < HOUR_MS) return t('settings.usage.relative.minutes', { count: Math.floor(elapsed / MINUTE_MS) })
  if (elapsed < DAY_MS) return t('settings.usage.relative.hours', { count: Math.floor(elapsed / HOUR_MS) })
  if (elapsed < MONTH_MS) return t('settings.usage.relative.days', { count: Math.floor(elapsed / DAY_MS) })
  if (elapsed < YEAR_MS) return t('settings.usage.relative.months', { count: Math.floor(elapsed / MONTH_MS) })
  return t('settings.usage.relative.years', { count: Math.floor(elapsed / YEAR_MS) })
}
