import { describe, expect, test } from 'vitest'
import type { MaterialNode } from '../../../src/shared/types/materials'
import {
  filterLinkPickerFiles,
  flattenMaterialFiles,
  materialLinkDescriptor
} from '../../../src/renderer/src/features/links/LinkPickerDialog'
import { canConnectMaterial } from '../../../src/renderer/src/features/materials/MaterialsContextMenu'

const tree: MaterialNode[] = [
  { relPath: '현재.md', name: '현재.md', kind: 'note' },
  {
    relPath: '강의',
    name: '강의',
    kind: 'dir',
    children: [
      { relPath: '강의/Week 1.pdf', name: 'Week 1.pdf', kind: 'pdf' },
      { relPath: '강의/보충.md', name: '보충.md', kind: 'note' }
    ]
  },
  { relPath: '그림/도식.png', name: '도식.png', kind: 'image' }
]

describe('LinkPickerDialog material list', () => {
  test('flattens files and excludes the source material', () => {
    const files = flattenMaterialFiles(tree)
    const visible = filterLinkPickerFiles(files, '현재.md', '')

    expect(files.map((file) => file.relPath)).toEqual([
      '현재.md',
      '강의/Week 1.pdf',
      '강의/보충.md',
      '그림/도식.png'
    ])
    expect(visible.map((file) => file.relPath)).not.toContain('현재.md')
  })

  test('filters case-insensitively by filename or relative path', () => {
    const files = flattenMaterialFiles(tree)

    expect(
      filterLinkPickerFiles(files, '현재.md', 'WEEK').map(
        (file) => file.relPath
      )
    ).toEqual(['강의/Week 1.pdf'])
    expect(
      filterLinkPickerFiles(files, '현재.md', '그림/').map(
        (file) => file.relPath
      )
    ).toEqual(['그림/도식.png'])
  })

  test('derives note and generic file descriptors from the shared kind helper', () => {
    expect(materialLinkDescriptor('course-1', '요약.markdown')).toEqual({
      kind: 'note',
      payload: { courseId: 'course-1', relPath: '요약.markdown' }
    })
    expect(materialLinkDescriptor('course-1', '녹화/강의.mp4')).toEqual({
      kind: 'file',
      payload: { courseId: 'course-1', relPath: '녹화/강의.mp4' }
    })
  })

  test('allows the context-menu action only for files', () => {
    expect(canConnectMaterial(tree[0] ?? null)).toBe(true)
    expect(canConnectMaterial(tree[1] ?? null)).toBe(false)
    expect(canConnectMaterial(null)).toBe(false)
  })
})
