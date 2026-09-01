import { describe, expect, test } from 'vitest'
import type { TabDescriptor } from '../../../src/shared/tabs'
import type {
  MaterialBacklinkGroup,
  MaterialLinkRecord
} from '../../../src/shared/types/link'
import type { LinkPickerFile } from '../../../src/renderer/src/features/links/LinkPickerDialog'
import {
  buildLinkGraph,
  nodeDegrees
} from '../../../src/renderer/src/features/links/graph/linkGraphModel'

const COURSE_ID = 'c1'

function file(relPath: string, kind: LinkPickerFile['kind'] = 'pdf'): LinkPickerFile {
  return { relPath, name: relPath.split('/').at(-1) ?? relPath, kind }
}

function descriptor(relPath: string): TabDescriptor {
  return { kind: 'pdf', payload: { courseId: COURSE_ID, relPath } }
}

function link(
  id: string,
  source: TabDescriptor,
  target: TabDescriptor,
  label = ''
): MaterialLinkRecord {
  return { id, courseId: COURSE_ID, source, target, label, createdAt: '2026-01-01T00:00:00Z' }
}

function backlinkGroup(
  relPath: string,
  noteRefs: string[],
  boardRefs: string[] = []
): MaterialBacklinkGroup {
  return {
    relPath,
    notes: noteRefs.map((ref) => ({ ref, label: ref, page: 1, detail: '' })),
    boards: boardRefs.map((ref) => ({ ref, label: `보드 ${ref}`, page: null, detail: '' }))
  }
}

describe('buildLinkGraph', () => {
  test('merges NFD file paths with NFC link paths into one node', () => {
    const nfd = '강의자료.pdf'.normalize('NFD')
    const nfc = '강의자료.pdf'.normalize('NFC')
    const graph = buildLinkGraph(
      [file(nfd), file('노트.md', 'note')],
      [link('l1', descriptor(nfc), descriptor('노트.md'))],
      []
    )

    expect(graph.nodes).toHaveLength(2)
    expect(graph.edges).toHaveLength(1)
    expect(graph.nodes.every((node) => node.kind !== 'missing')).toBe(true)
  })

  test('keeps deleted link targets as ghost nodes instead of hiding them', () => {
    const graph = buildLinkGraph(
      [file('a.pdf')],
      [link('l1', descriptor('a.pdf'), descriptor('지워진.md'))],
      []
    )

    const ghost = graph.nodes.find((node) => node.kind === 'missing')
    expect(ghost).toBeDefined()
    expect(ghost!.label).toBe('지워진.md')
    expect(graph.edges).toHaveLength(1)
  })

  test('keeps browser descriptors as nodes with their descriptor preserved', () => {
    const browser: TabDescriptor = {
      kind: 'browser',
      payload: { tabId: 't1', initialUrl: 'https://example.org' }
    }
    const graph = buildLinkGraph(
      [file('a.pdf')],
      [link('l1', browser, descriptor('a.pdf'))],
      []
    )

    const node = graph.nodes.find((entry) => entry.kind === 'browser')
    expect(node).toBeDefined()
    expect(node!.descriptor).toEqual(browser)
  })

  test('merges duplicate edges and drops self loops', () => {
    const graph = buildLinkGraph(
      [file('a.pdf'), file('b.md', 'note')],
      [
        link('l1', descriptor('a.pdf'), descriptor('b.md')),
        link('l2', descriptor('a.pdf'), descriptor('b.md')),
        link('self', descriptor('a.pdf'), descriptor('A.PDF'))
      ],
      []
    )

    expect(graph.edges).toHaveLength(1)
  })

  test("label 'next' becomes a sequence edge, others stay plain links", () => {
    const graph = buildLinkGraph(
      [file('a.pdf'), file('b.md', 'note'), file('c.md', 'note')],
      [
        link('l1', descriptor('a.pdf'), descriptor('b.md'), 'next'),
        link('l2', descriptor('a.pdf'), descriptor('c.md'), '복습')
      ],
      []
    )

    expect(graph.edges.map((edge) => edge.kind).sort()).toEqual([
      'link',
      'sequence'
    ])
  })

  test('a note citing many pages of one material yields a single backlink edge', () => {
    const group: MaterialBacklinkGroup = {
      relPath: 'a.pdf',
      notes: [
        { ref: '노트.md', label: '노트.md', page: 1, detail: '' },
        { ref: '노트.md', label: '노트.md', page: 5, detail: '' }
      ],
      boards: []
    }
    const graph = buildLinkGraph(
      [file('a.pdf'), file('노트.md', 'note')],
      [],
      [group]
    )

    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]!.kind).toBe('backlink')
  })

  test('board citations become board nodes without an openable descriptor', () => {
    const graph = buildLinkGraph(
      [file('a.pdf')],
      [],
      [backlinkGroup('a.pdf', [], ['board-1'])]
    )

    const board = graph.nodes.find((node) => node.kind === 'board')
    expect(board).toBeDefined()
    expect(board!.descriptor).toBeNull()
  })

  test('neighbors are symmetric and include the node itself', () => {
    const graph = buildLinkGraph(
      [file('a.pdf'), file('b.md', 'note')],
      [link('l1', descriptor('a.pdf'), descriptor('b.md'))],
      []
    )
    const [a, b] = graph.nodes
    expect(graph.neighbors.get(a!.id)?.has(a!.id)).toBe(true)
    expect(graph.neighbors.get(a!.id)?.has(b!.id)).toBe(true)
    expect(graph.neighbors.get(b!.id)?.has(a!.id)).toBe(true)
  })

  test('nodeDegrees counts both endpoints', () => {
    const graph = buildLinkGraph(
      [file('a.pdf'), file('b.md', 'note'), file('c.md', 'note')],
      [
        link('l1', descriptor('a.pdf'), descriptor('b.md')),
        link('l2', descriptor('a.pdf'), descriptor('c.md'))
      ],
      []
    )
    const degrees = nodeDegrees(graph)
    const hub = graph.nodes.find((node) => node.relPath === 'a.pdf')
    expect(degrees.get(hub!.id)).toBe(2)
  })
})
