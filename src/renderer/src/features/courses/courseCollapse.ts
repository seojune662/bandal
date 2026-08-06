export const COLLAPSED_COURSES_STORAGE_KEY =
  'bandal:course-sidebar:collapsed:v1'

interface StorageReader {
  getItem: (key: string) => string | null
}

interface StorageWriter {
  setItem: (key: string, value: string) => void
}

export function readCollapsedCourseIds(
  storage: StorageReader | null =
    typeof window === 'undefined' ? null : window.localStorage
): Set<string> {
  if (storage === null) return new Set()
  try {
    const parsed: unknown = JSON.parse(
      storage.getItem(COLLAPSED_COURSES_STORAGE_KEY) ?? '[]'
    )
    if (!Array.isArray(parsed)) return new Set()
    return new Set(
      parsed.filter(
        (value): value is string =>
          typeof value === 'string' && value.trim().length > 0
      )
    )
  } catch {
    return new Set()
  }
}

export function persistCollapsedCourseIds(
  ids: ReadonlySet<string>,
  storage: StorageWriter | null =
    typeof window === 'undefined' ? null : window.localStorage
): void {
  if (storage === null) return
  try {
    storage.setItem(
      COLLAPSED_COURSES_STORAGE_KEY,
      JSON.stringify([...ids].sort())
    )
  } catch {
    // localStorage is best-effort (for example, it can be disabled by policy).
  }
}
