export const COURSE_COLORS = [
  'gold',
  'green',
  'blue',
  'pink',
  'violet',
  'orange',
  'red'
] as const

export type CourseColor = (typeof COURSE_COLORS)[number]

/** Unknown stored values keep the colour they always showed: this list predates `red`. */
const FALLBACK_COLORS: readonly CourseColor[] = ['gold', 'green', 'blue', 'pink', 'violet', 'orange']

const colorLabels: Record<CourseColor, string> = {
  gold: '문골드',
  green: '세이지',
  blue: '블루',
  pink: '핑크',
  violet: '바이올렛',
  orange: '오렌지',
  red: '레드'
}

export function courseColorLabel(color: CourseColor): string {
  return colorLabels[color]
}

export function normalizeCourseColor(color: string): CourseColor {
  if (COURSE_COLORS.some((candidate) => candidate === color)) {
    return color as CourseColor
  }

  let hash = 0
  for (const character of color) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length] ?? 'gold'
}
