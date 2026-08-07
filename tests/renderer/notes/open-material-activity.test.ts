import { beforeEach, describe, expect, test, vi } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn()
}))

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: invokeMock
}))

import {
  MATERIAL_OPEN_DEDUPE_MS,
  openMaterialInCourse,
  shouldRecordMaterialOpen
} from '../../../src/renderer/src/features/workspace/openMaterial'

describe('material-opened activity deduplication', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue({ ok: true })
  })

  test('records a file with no prior activity', () => {
    expect(shouldRecordMaterialOpen(undefined, 1_000)).toBe(true)
  })

  test('suppresses the same file inside the five minute window', () => {
    expect(shouldRecordMaterialOpen(1_000, 1_000 + MATERIAL_OPEN_DEDUPE_MS - 1)).toBe(
      false
    )
  })

  test('records again at the boundary', () => {
    expect(shouldRecordMaterialOpen(1_000, 1_000 + MATERIAL_OPEN_DEDUPE_MS)).toBe(
      true
    )
  })

  test('recovers when the client clock moves backwards', () => {
    expect(shouldRecordMaterialOpen(2_000, 1_000)).toBe(true)
  })

  test('records a tab material and suppresses an immediate duplicate', () => {
    openMaterialInCourse('course-activity', 'note', 'quiz/activity-test.md')
    openMaterialInCourse('course-activity', 'note', 'quiz/activity-test.md')

    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith('activity:record', {
      courseId: 'course-activity',
      kind: 'material-opened',
      relPath: 'quiz/activity-test.md',
      summary: 'quiz/activity-test.md을(를) 열었습니다.'
    })
  })

  test('swallows activity recording failures', async () => {
    invokeMock.mockRejectedValueOnce(new Error('activity unavailable'))

    expect(() =>
      openMaterialInCourse('course-activity', 'note', 'quiz/failure-test.md')
    ).not.toThrow()
    await Promise.resolve()
  })
})
