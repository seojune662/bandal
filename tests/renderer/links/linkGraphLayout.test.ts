import { describe, expect, test } from 'vitest'
import type {
  GraphEdge,
  GraphNode
} from '../../../src/renderer/src/features/links/graph/linkGraphModel'
import {
  hashString,
  layoutGraph
} from '../../../src/renderer/src/features/links/graph/linkGraphLayout'

const SIZE = { width: 1200, height: 800 }

function node(id: string): GraphNode {
  return { id, label: id, kind: 'pdf', descriptor: null, relPath: id }
}

function edge(sourceId: string, targetId: string): GraphEdge {
  return { id: `${sourceId}-${targetId}`, sourceId, targetId, kind: 'link' }
}

function makeNodes(count: number): GraphNode[] {
  return Array.from({ length: count }, (_, index) => node(`n${index}`))
}

describe('layoutGraph', () => {
  test('is deterministic — same input, same coordinates', () => {
    const nodes = makeNodes(12)
    const edges = [edge('n0', 'n1'), edge('n1', 'n2'), edge('n3', 'n4')]
    const first = layoutGraph(nodes, edges, SIZE)
    const second = layoutGraph(nodes, edges, SIZE)
    expect([...first.entries()]).toEqual([...second.entries()])
  })

  test('never produces NaN or Infinity, even with overlapping seeds', () => {
    const nodes = makeNodes(30)
    const edges = nodes.slice(1).map((entry, index) => edge(`n${index}`, entry.id))
    const positions = layoutGraph(nodes, edges, SIZE)
    for (const point of positions.values()) {
      expect(Number.isFinite(point.x)).toBe(true)
      expect(Number.isFinite(point.y)).toBe(true)
    }
  })

  test('keeps every node inside the canvas', () => {
    const positions = layoutGraph(makeNodes(40), [], SIZE)
    for (const point of positions.values()) {
      expect(point.x).toBeGreaterThanOrEqual(0)
      expect(point.x).toBeLessThanOrEqual(SIZE.width)
      expect(point.y).toBeGreaterThanOrEqual(0)
      expect(point.y).toBeLessThanOrEqual(SIZE.height)
    }
  })

  test('keeps distinct nodes apart', () => {
    const positions = [...layoutGraph(makeNodes(10), [], SIZE).values()]
    for (let a = 0; a < positions.length; a += 1) {
      for (let b = a + 1; b < positions.length; b += 1) {
        const distance = Math.hypot(
          positions[a]!.x - positions[b]!.x,
          positions[a]!.y - positions[b]!.y
        )
        expect(distance).toBeGreaterThan(1)
      }
    }
  })

  test('pulls linked nodes closer than unlinked ones on average', () => {
    const nodes = makeNodes(12)
    // n0..n5 는 사슬로 연결, n6..n11 은 고립.
    const edges = [0, 1, 2, 3, 4].map((index) => edge(`n${index}`, `n${index + 1}`))
    const positions = layoutGraph(nodes, edges, SIZE)

    const distance = (a: string, b: string): number => {
      const pa = positions.get(a)!
      const pb = positions.get(b)!
      return Math.hypot(pa.x - pb.x, pa.y - pb.y)
    }
    const linkedAverage =
      edges.reduce((sum, e) => sum + distance(e.sourceId, e.targetId), 0) /
      edges.length
    const unlinkedPairs: Array<[string, string]> = [
      ['n6', 'n8'],
      ['n7', 'n10'],
      ['n9', 'n11']
    ]
    const unlinkedAverage =
      unlinkedPairs.reduce((sum, [a, b]) => sum + distance(a, b), 0) /
      unlinkedPairs.length

    expect(linkedAverage).toBeLessThan(unlinkedAverage)
  })

  test('hashString is stable and unsigned', () => {
    expect(hashString('bandal')).toBe(hashString('bandal'))
    expect(hashString('bandal')).toBeGreaterThanOrEqual(0)
    expect(hashString('a')).not.toBe(hashString('b'))
  })
})
