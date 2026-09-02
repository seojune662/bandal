import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDrawingsRepo, type DrawingsRepo } from '../../../src/main/features/pdf'
import { createCoursesRepo } from '../../../src/main/features/courses'
import { NotFoundError, ValidationError } from '../../../src/main/db/errors'
import type { CreateDrawingInput, DrawingStyle } from '../../../src/shared/types/drawing'
import { createTestDb, type TestDb } from '../helpers/testDb'

describe('drawingsRepo', () => {
  let ctx: TestDb
  let repo: DrawingsRepo
  let courseId: string

  function validInput(): CreateDrawingInput {
    return {
      courseId,
      relPath: 'slides/week1.pdf',
      page: 2,
      kind: 'ink',
      data: {
        points: [
          { x: 0.125, y: 0.25, p: 0.4 },
          { x: 0.875, y: 0.75, p: 0.9 }
        ]
      },
      style: { color: 'blue', width: 0.006, opacity: 0.92 }
    }
  }

  beforeEach(() => {
    ctx = createTestDb()
    const courses = createCoursesRepo({ db: ctx.db, getDataRoot: () => ctx.dir })
    courseId = courses.create({ name: 'Drawing Course', color: '#000' }).id
    repo = createDrawingsRepo(ctx.db)
  })

  afterEach(() => ctx.cleanup())

  test('creates and round-trips normalized points, pressure, and style', () => {
    const created = repo.create(validInput())
    const listed = repo.listForFile(courseId, 'slides/week1.pdf')

    expect(listed).toEqual([created])
    expect(listed[0]?.data.points?.[0]).toEqual({ x: 0.125, y: 0.25, p: 0.4 })
    expect(listed[0]?.data.points?.[1]?.x).toBeCloseTo(0.875)
    expect(listed[0]?.style.width).toBeCloseTo(0.006)
  })

  test('round-trips normalized boxes and textbox content', () => {
    const created = repo.create({
      ...validInput(),
      kind: 'textbox',
      data: {
        box: { x: 0.1, y: 0.2, width: 0.45, height: 0.16 },
        text: '핵심 개념'
      },
      style: { color: 'ink', width: 0.002, opacity: 1, fontScale: 1.2 }
    })

    expect(repo.listForFile(courseId, created.relPath)[0]).toEqual(created)
  })

  test('round-trips bold, italic, underline, strike, align and fill on a textbox', () => {
    const style: DrawingStyle = {
      color: 'ink',
      width: 0.002,
      opacity: 1,
      fontScale: 1.5,
      bold: true,
      italic: true,
      underline: true,
      strike: false,
      align: 'center',
      fill: 'yellow'
    }

    const created = repo.create({
      ...validInput(),
      kind: 'textbox',
      data: { box: { x: 0.1, y: 0.2, width: 0.45, height: 0.16 }, text: '서식' },
      style
    })
    const updated = repo.update({
      id: created.id,
      style: { ...style, italic: false, align: 'right', fill: 'blue' }
    })

    expect(created.style).toEqual(style)
    expect(repo.listForFile(courseId, created.relPath)[0]?.style).toEqual({
      ...style,
      italic: false,
      align: 'right',
      fill: 'blue'
    })
    expect(updated.style).toEqual({ ...style, italic: false, align: 'right', fill: 'blue' })
  })

  test('keeps absent text-style fields absent instead of defaulting them', () => {
    const created = repo.create(validInput())

    expect(created.style).toEqual({ color: 'blue', width: 0.006, opacity: 0.92 })
    expect(Object.keys(created.style)).not.toContain('align')
    expect(Object.keys(created.style)).not.toContain('fill')
  })

  test.each([
    ['align', 'justify'],
    ['align', 0],
    ['fill', 'pink'],
    ['fill', '#ffff00'],
    ['italic', 'yes'],
    ['underline', 1],
    ['strike', 'true'],
    ['bold', null]
  ])('rejects style.%s = %j', (field, value) => {
    const style = { ...validInput().style, [field]: value } as unknown as DrawingStyle

    expect(() => repo.create({ ...validInput(), style })).toThrow(ValidationError)
    expect(() => repo.create({ ...validInput(), style })).toThrow(`style.${field}`)
  })

  test('updates geometry and style without changing file identity', () => {
    const created = repo.create(validInput())
    const data = { points: [{ x: 0.4, y: 0.5, p: 0.7 }] }
    const style = { color: 'red' as const, width: 0.01, opacity: 0.5 }

    const updated = repo.update({ id: created.id, data, style })

    expect(updated.data).toEqual(data)
    expect(updated.style).toEqual(style)
    expect(updated.page).toBe(created.page)
    expect(updated.relPath).toBe(created.relPath)
  })

  test('lists only the requested file ordered by page then creation', () => {
    repo.create({ ...validInput(), page: 3 })
    repo.create({ ...validInput(), page: 1 })
    repo.create({ ...validInput(), relPath: 'slides/week2.pdf' })

    expect(repo.listForFile(courseId, 'slides/week1.pdf').map((item) => item.page)).toEqual([1, 3])
    expect(repo.listForFile(courseId, 'slides/week2.pdf')).toHaveLength(1)
  })

  test('soft-deletes multiple drawings and excludes them from update/list', () => {
    const first = repo.create(validInput())
    const second = repo.create({ ...validInput(), page: 4 })

    repo.softDelete([first.id, second.id])

    expect(repo.listForFile(courseId, first.relPath)).toEqual([])
    expect(() => repo.update({ id: first.id, style: first.style })).toThrow(NotFoundError)
  })

  test('rejects unknown courses and coordinates outside normalized page space', () => {
    expect(() => repo.create({ ...validInput(), courseId: 'missing' })).toThrow(NotFoundError)
    expect(() => repo.create({
      ...validInput(),
      data: { points: [{ x: 1.01, y: 0.2, p: 0.5 }] }
    })).toThrow(ValidationError)
    expect(() => repo.create({
      ...validInput(),
      kind: 'rect',
      data: { box: { x: 0.8, y: 0.2, width: 0.3, height: 0.2 } }
    })).toThrow(ValidationError)
  })
})
