import { expect, test } from 'vitest'
import { COURSE_COLORS, courseColorLabel, normalizeCourseColor } from '../../../src/renderer/src/features/courses/courseColors'

test('the course colours are the seven sync spec tokens', () => {
  expect([...COURSE_COLORS].sort()).toEqual(['blue', 'gold', 'green', 'orange', 'pink', 'red', 'violet'])
  expect(normalizeCourseColor('red')).toBe('red')
  expect(courseColorLabel('red')).toBe('레드')
})

test('unknown stored colours still show the colour they showed before red existed', () => {
  // Expected values come from the six-colour normalizeCourseColor on main before this change.
  const before = { mint: 'blue', teal: 'blue', '#ff0000': 'green', purple: 'violet', yellow: 'blue', '': 'gold' }
  expect(Object.fromEntries(Object.keys(before).map(legacy => [legacy, normalizeCourseColor(legacy)]))).toEqual(before)
})
