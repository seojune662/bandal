import { expect, test } from 'vitest'
import { sortMaterials } from '../../../src/renderer/src/features/materials/materialPresentation'
import type { MaterialNode } from '../../../src/shared/types/materials'

test('folder-first natural ordering and date/type sorts never mutate the source tree', () => {
  const nodes: MaterialNode[] = [
    { kind: 'pdf', name: '강의 10.pdf', relPath: '강의 10.pdf', mtime: NaN },
    { kind: 'note', name: '강의 2.md', relPath: '강의 2.md', mtime: 300 },
    { kind: 'dir', name: '폴더', relPath: '폴더', children: [] },
    { kind: 'pdf', name: '강의 1.pdf', relPath: '강의 1.pdf', mtime: 200 }
  ]
  expect(sortMaterials(nodes, 'name').map(node => node.name)).toEqual(['폴더', '강의 1.pdf', '강의 2.md', '강의 10.pdf'])
  expect(sortMaterials(nodes, 'modified').map(node => node.name)).toEqual(['폴더', '강의 2.md', '강의 1.pdf', '강의 10.pdf'])
  expect(sortMaterials(nodes, 'kind').map(node => node.kind)).toEqual(['dir', 'note', 'pdf', 'pdf'])
  expect(nodes[0]?.name).toBe('강의 10.pdf')
})
