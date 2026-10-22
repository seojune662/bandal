import { expect, test } from 'vitest'
import { workspaceDestination, workspaceMaterialTree, workspaceSearchResults } from '../../../src/renderer/src/features/materials/workspaceMaterials'
import type { MaterialNode } from '../../../src/shared/types/materials'
test('scopes both displayed tree and search without changing owner-relative paths', () => {
  const child: MaterialNode = { kind: 'note', relPath: 'project/note.md', name: 'note.md' }
  const tree: MaterialNode[] = [{ kind: 'dir', relPath: 'project', name: 'project', children: [child] }, { kind: 'note', relPath: 'private.md', name: 'private.md' }]
  expect(workspaceMaterialTree(tree, 'project')).toEqual([child])
  expect(workspaceMaterialTree(tree, 'missing')).toEqual([])
  expect(workspaceSearchResults([{ relPath: 'project/note.md', name: 'note.md', kind: 'note', score: 1 }, { relPath: 'project2/note.md', name: 'note.md', kind: 'note', score: 1 }], 'project')).toHaveLength(1)
})
test('empty and parent destinations resolve to project root', () => {
  expect(workspaceDestination('', 'a/project')).toBe('a/project')
  expect(workspaceDestination('a', 'a/project')).toBe('a/project')
  expect(workspaceDestination('a/project/nested', 'a/project')).toBe('a/project/nested')
})
