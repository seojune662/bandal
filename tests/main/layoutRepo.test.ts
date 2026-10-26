import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createLayoutRepo, type LayoutRepo } from '../../src/main/db/layoutRepo'
import { createCoursesRepo } from '../../src/main/features/courses'
import { ValidationError } from '../../src/main/db/errors'
import { createTestDb, type TestDb } from './helpers/testDb'

describe('layoutRepo', () => {
  let ctx: TestDb
  let repo: LayoutRepo
  let courseId: string

  beforeEach(() => {
    ctx = createTestDb()
    const courses = createCoursesRepo({ db: ctx.db, getDataRoot: () => ctx.dir })
    courseId = courses.create({ name: 'Course', color: '#000' }).id
    repo = createLayoutRepo(ctx.db)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('returns null for a course with no saved layout', () => {
    // Act / Assert
    expect(repo.get(courseId)).toEqual({ layout: null })
  })

  test('round-trips a layout object and overwrites on re-save', () => {
    // Arrange
    const layoutV1 = { grid: { panels: ['a'] } }
    const layoutV2 = { grid: { panels: ['a', 'b'] } }

    // Act
    repo.save(courseId, layoutV1)
    repo.save(courseId, layoutV2)

    // Assert
    expect(repo.get(courseId)).toEqual({ layout: layoutV2 })
  })

  test('rejects saving a layout for an unknown course', () => {
    // Act / Assert
    expect(() => repo.save('ghost', {})).toThrow(ValidationError)
  })

  test('saves both placements together and rejects a batch before changing either', () => {
    const courses = createCoursesRepo({ db: ctx.db, getDataRoot: () => ctx.dir })
    const targetId = courses.create({ name: 'Target', color: '#000' }).id
    repo.saveMany([{ courseId, layout: { panels: ['page'] } }, { courseId: targetId, layout: { panels: [] } }])
    expect(() => repo.saveMany([
      { courseId, layout: { panels: [] } }, { courseId: 'missing', layout: { panels: ['page'] } }
    ])).toThrow(ValidationError)
    expect(repo.get(courseId).layout).toEqual({ panels: ['page'] })
    repo.saveMany([{ courseId, layout: { panels: [] } }, { courseId: targetId, layout: { panels: ['page'] } }])
    expect(repo.get(courseId).layout).toEqual({ panels: [] })
    expect(repo.get(targetId).layout).toEqual({ panels: ['page'] })
  })

  test('rolls back every layout when the second SQL write fails', () => {
    const courses = createCoursesRepo({ db: ctx.db, getDataRoot: () => ctx.dir })
    const targetId = courses.create({ name: 'Target', color: '#000' }).id
    repo.save(courseId, { panels: ['page'] })
    ctx.db.exec(`CREATE TRIGGER reject_target BEFORE INSERT ON tabs_layout
      WHEN NEW.course_id = '${targetId}' BEGIN SELECT RAISE(ABORT, 'test failure'); END`)
    expect(() => repo.saveMany([
      { courseId, layout: { panels: [] } }, { courseId: targetId, layout: { panels: ['page'] } }
    ])).toThrow('test failure')
    expect(repo.get(courseId).layout).toEqual({ panels: ['page'] })
    expect(repo.get(targetId).layout).toBeNull()
  })

  test('rejects duplicate courses and nonserializable layouts', () => {
    expect(() => repo.saveMany([{ courseId, layout: {} }, { courseId, layout: {} }])).toThrow(ValidationError)
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic
    expect(() => repo.saveMany([{ courseId, layout: cyclic }])).toThrow(ValidationError)
    expect(repo.get(courseId).layout).toBeNull()
  })

  test('keeps course, root project and two nested projects distinct in one atomic save', () => {
    repo.saveMany([
      { courseId, layout: { marker: 'course' } },
      { courseId, projectRootRelPath: '', layout: { marker: 'root-project' } },
      { courseId, projectRootRelPath: 'English', layout: { marker: 'english' } },
      { courseId, projectRootRelPath: 'Review', layout: { marker: 'review' } }
    ])
    expect(repo.get(courseId).layout).toEqual({ marker: 'course' })
    expect(repo.get(courseId, '').layout).toEqual({ marker: 'root-project' })
    expect(repo.get(courseId, 'English').layout).toEqual({ marker: 'english' })
    expect(repo.get(courseId, 'Review').layout).toEqual({ marker: 'review' })
    expect(() => repo.save(courseId, {}, '../outside')).toThrow(ValidationError)
  })

  test('imports only a nested project panes and retains the first raw backup after migration', () => {
    const panels = {
      project: { id: 'project', params: { descriptor: { kind: 'learning', payload: { courseId, rootRelPath: 'English', view: 'reader', itemId: 'a' } } } },
      document: { id: 'document', params: { descriptor: { kind: 'note', payload: { courseId, relPath: 'English/notes.md' } } } },
      other: { id: 'other', params: { descriptor: { kind: 'note', payload: { courseId, relPath: 'course.md' } } } }
    }
    const legacy = { panels, grid: { root: { type: 'leaf', data: { id: 'g', views: ['project', 'document', 'other'], activeView: 'other' } } } }
    repo.save(courseId, legacy)
    const result = repo.get(courseId, 'English')
    expect(result.legacyProjectLayout).toBe(true)
    expect(Object.keys((result.layout as typeof legacy).panels)).toEqual(['project', 'document'])
    expect((result.layout as typeof legacy).grid.root.data).toMatchObject({ views: ['project', 'document'], activeView: 'project' })
    repo.save(courseId, { migrated: true }, 'English')
    repo.save(courseId, { migrated: 'later' }, 'English')
    expect(JSON.parse((ctx.db.prepare('SELECT layout_json FROM workspace_layout_backups WHERE scope_key LIKE ?').get('project:%') as { layout_json: string }).layout_json)).toEqual(legacy)
    expect(repo.get(courseId).layout).toEqual(legacy)
  })

  test('the first multiwindow save preserves the raw legacy backup and rejects malformed collections', () => {
    const legacy = { panels: {}, grid: { root: { type: 'branch', data: [] } } }
    repo.save(courseId, legacy)
    const envelope = { kind: 'workspace-windows', version: 1, activeWindowId: 'second', windows: [
      { id: 'main', name: '기존 작업', chromeMode: 'all', layout: legacy },
      { id: 'second', name: '새 작업', chromeMode: 'all-hidden', layout: legacy }
    ] }
    repo.save(courseId, envelope)
    expect(repo.get(courseId).layout).toEqual(envelope)
    expect(JSON.parse((ctx.db.prepare('SELECT layout_json FROM workspace_layout_backups WHERE scope_key=?').get(courseId) as { layout_json: string }).layout_json)).toEqual(legacy)
    expect(() => repo.save(courseId, { ...envelope, windows: [] })).toThrow(ValidationError)
    expect(repo.get(courseId).layout).toEqual(envelope)
  })

  test('window migration backs up the immediate course and project layouts even when older backups exist', () => {
    for (const root of [undefined, 'English']) {
      const oldest = { marker: 'oldest' }, latest = { marker: 'immediate-before-windows' }
      repo.save(courseId, oldest, root)
      repo.save(courseId, latest, root)
      const envelope = { kind: 'workspace-windows', version: 1, activeWindowId: 'main', windows: [{ id: 'main', name: '윈도우 1', chromeMode: 'all', layout: latest }] }
      repo.save(courseId, envelope, root)
      repo.save(courseId, { ...envelope, windows: [{ ...envelope.windows[0], name: 'Renamed' }] }, root)
      const scope = root === undefined ? courseId : `project:${JSON.stringify([courseId, root])}`
      const backup = (key: string) => JSON.parse((ctx.db.prepare('SELECT layout_json FROM workspace_layout_backups WHERE scope_key=?').get(key) as { layout_json: string }).layout_json)
      // The separate migration record must never overwrite either backup.
      expect(backup(`windows-v1:${scope}`)).toEqual(latest)
      if (root === undefined) expect(backup(scope)).toEqual(oldest)
    }
  })

  test('a new project starts empty and legacy project import retains only windows with matching panes', () => {
    const layout = (path: string) => ({ panels: { note: { id: 'note', params: { descriptor: { kind: 'note', payload: { courseId, relPath: path } } } } },
      grid: { root: { type: 'leaf', data: { id: 'g', views: ['note'], activeView: 'note' } } } })
    repo.save(courseId, { kind: 'workspace-windows', version: 1, activeWindowId: 'main', windows: [
      { id: 'main', name: 'Other', chromeMode: 'all-hidden', layout: layout('course.md') },
      { id: 'project', name: 'English', chromeMode: 'tabs-hidden', layout: layout('English/note.md') }
    ] })
    expect(repo.get(courseId, 'Fresh').layout).toBeNull()
    expect(repo.get(courseId, 'English').layout).toMatchObject({ activeWindowId: 'project', windows: [{ id: 'project', name: 'English' }] })
  })
})
