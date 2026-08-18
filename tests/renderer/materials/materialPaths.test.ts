import { describe, expect, test } from 'vitest'
import type { MaterialNode } from '../../../src/shared/types/materials'
import {
  absoluteMaterialPath,
  findMaterialNode,
  kindForMaterialName,
  materialParentPath,
  targetDirectory,
  unusedFolderName
} from '../../../src/renderer/src/features/materials/materialPaths'

const tree: MaterialNode[] = [
  {
    relPath: 'notes',
    name: 'notes',
    kind: 'dir',
    children: [
      { relPath: 'notes/새 폴더', name: '새 폴더', kind: 'dir', children: [] },
      { relPath: 'notes/새 폴더-2', name: '새 폴더-2', kind: 'dir', children: [] },
      { relPath: 'notes/week.md', name: 'week.md', kind: 'note' }
    ]
  }
]

describe('materialPaths', () => {
  test('derives parent and context target directories', () => {
    expect(materialParentPath('notes/week.md')).toBe('notes')
    expect(materialParentPath('week.md')).toBe('')
    expect(targetDirectory(tree[0] ?? null)).toBe('notes')
    expect(targetDirectory(tree[0]?.children?.[2] ?? null)).toBe('notes')
    expect(targetDirectory(null)).toBe('')
    expect(findMaterialNode(tree, 'notes/week.md')?.name).toBe('week.md')
    expect(findMaterialNode(tree, 'missing')).toBeNull()
  })

  test('joins absolute paths with the course folder native separator', () => {
    expect(absoluteMaterialPath('/Users/student/course/', 'notes/week.md')).toBe(
      '/Users/student/course/notes/week.md'
    )
    expect(absoluteMaterialPath('C:\\Study\\OS', 'notes/week.md')).toBe(
      'C:\\Study\\OS\\notes\\week.md'
    )
  })

  test('classifies renamed files and picks an unused new-folder name', () => {
    expect(kindForMaterialName('lecture.PDF')).toBe('pdf')
    expect(kindForMaterialName('lecture.md')).toBe('note')
    expect(kindForMaterialName('lecture.mp4')).toBe('video')
    expect(kindForMaterialName('lecture.WEBM')).toBe('video')
    expect(kindForMaterialName('lecture.zip')).toBe('other')
    expect(unusedFolderName(tree, 'notes')).toBe('새 폴더-3')
    expect(unusedFolderName(tree, '')).toBe('새 폴더')
  })
})
