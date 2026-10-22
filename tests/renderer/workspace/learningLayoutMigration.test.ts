import { describe, expect, test, vi } from 'vitest'
import type { LearningProjectSnapshot } from '../../../src/shared/types/learning'
import type { TabDescriptor } from '../../../src/shared/tabs'
import { migrateLearningLayout } from '../../../src/renderer/src/features/workspace/learningLayoutMigration'
import { tabPanelId } from '../../../src/renderer/src/features/workspace/tabIdentity'
import { validateLayout } from '../../../src/renderer/src/features/workspace/layoutPersistence'

function fixture(descriptors: TabDescriptor[]) {
  const ids = descriptors.map(tabPanelId)
  return { panels: Object.fromEntries(descriptors.map((descriptor, index) => [ids[index]!, { id: ids[index], contentComponent: descriptor.kind, params: { descriptor } }])), grid: { root: { type: 'leaf', data: { id: 'g', views: ids, activeView: ids[0] } }, width: 800, height: 600, orientation: 'HORIZONTAL' }, activeGroup: 'g' }
}
describe('learning document layout migration', () => {
  test('replaces old reader identity, preserves neighboring owner documents, and validates on restart', async () => {
    const raw = fixture([{ kind: 'learning', payload: { courseId: 'owner', rootRelPath: 'English', view: 'reader', itemId: 'article-one' } }, { kind: 'note', payload: { courseId: 'owner', relPath: 'notes.md' } }])
    const migrated = await migrateLearningLayout(raw)
    const expected = tabPanelId({ kind: 'learning-resource', payload: { courseId: 'owner', rootRelPath: 'English', resource: { kind: 'article', id: 'article-one' } } })
    expect(migrated.changed).toBe(true)
    expect(Object.keys((migrated.layout as typeof raw).panels)).toEqual(['note:owner:notes.md', expected])
    expect((migrated.layout as typeof raw).grid.root.data.views).toEqual([expected, 'note:owner:notes.md'])
    expect(validateLayout(migrated.layout)?.droppedPanelIds).toEqual([])
    expect(raw.grid.root.data.views[0]).toBe('learning:owner:project:English')
    expect((await migrateLearningLayout(migrated.layout)).changed).toBe(false)
  })
  test('uses the reading progress to resolve implicit resume and never overwrites a failed read', async () => {
    const raw = fixture([{ kind: 'learning', payload: { courseId: 'owner', rootRelPath: '', view: 'reader' } }])
    const read = vi.fn(async () => ({ articles: [{ id: 'unread', status: 'unread' }, { id: 'reading', status: 'reading' }] }) as LearningProjectSnapshot)
    const result = await migrateLearningLayout(raw, read)
    expect(JSON.stringify(result.layout)).toContain('reading')
    expect(read).toHaveBeenCalledWith({ courseId: 'owner', rootRelPath: '' })
    await expect(migrateLearningLayout(raw, async () => { throw new Error('offline') })).rejects.toThrow('offline')
    expect(Object.keys(raw.panels)).toEqual(['learning:owner:project:'])
  })
  test('removes dashboard-only panes without resurrecting nested navigation', async () => {
    const result = await migrateLearningLayout(fixture([{ kind: 'learning', payload: { courseId: 'owner', rootRelPath: '', view: 'home' } }]))
    expect((result.layout as ReturnType<typeof fixture>).panels).toEqual({})
    expect((result.layout as ReturnType<typeof fixture>).grid.root.data.views).toEqual([])
  })
  test('independent articles and copied projects cannot alias the same tab', () => {
    const ids = ['a', 'b'].flatMap(id => ['', 'copied'].map(rootRelPath => tabPanelId({ kind: 'learning-resource', payload: { courseId: 'owner', rootRelPath, projectId: 'same-copy-id', resource: { kind: 'article', id } } })))
    expect(new Set(ids).size).toBe(4)
  })
})
