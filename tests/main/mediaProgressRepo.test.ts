import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createCoursesRepo } from '../../src/main/features/courses'
import { createMediaProgressRepo } from '../../src/main/features/materials/mediaProgressRepo'
import type { MediaProgressRepo } from '../../src/main/features/materials/mediaProgressRepo'
import { createTestDb, type TestDb } from './helpers/testDb'

describe('mediaProgressRepo (M18 영상 이어보기)', () => {
  let ctx: TestDb
  let repo: MediaProgressRepo
  let courseId: string

  beforeEach(() => {
    ctx = createTestDb()
    repo = createMediaProgressRepo(ctx.db)
    const courses = createCoursesRepo({
      db: ctx.db,
      getDataRoot: () => join(ctx.dir, 'root')
    })
    courseId = courses.create({ name: '전자기학', color: '#000' }).id
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('get returns null before any save', () => {
    expect(repo.get(courseId, 'lecture.mp4')).toBeNull()
  })

  test('set upserts and get round-trips', () => {
    repo.set({
      courseId,
      relPath: 'lecture.mp4',
      positionSec: 42.5,
      durationSec: 3600,
      playbackRate: 1.5
    })
    const updated = repo.set({
      courseId,
      relPath: 'lecture.mp4',
      positionSec: 90,
      durationSec: 3600,
      playbackRate: 2
    })

    expect(updated.positionSec).toBe(90)
    const loaded = repo.get(courseId, 'lecture.mp4')
    expect(loaded).not.toBeNull()
    expect(loaded?.positionSec).toBe(90)
    expect(loaded?.playbackRate).toBe(2)
    expect(loaded?.durationSec).toBe(3600)
  })

  test('rejects negative or non-finite positions', () => {
    expect(() =>
      repo.set({
        courseId,
        relPath: 'lecture.mp4',
        positionSec: -1,
        durationSec: null,
        playbackRate: 1
      })
    ).toThrow()
    expect(() =>
      repo.set({
        courseId,
        relPath: 'lecture.mp4',
        positionSec: Number.NaN,
        durationSec: null,
        playbackRate: 1
      })
    ).toThrow()
  })
})
