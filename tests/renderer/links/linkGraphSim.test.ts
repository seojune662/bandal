import { describe, expect, test } from 'vitest'
import type {
  GraphEdge,
  GraphNode
} from '../../../src/renderer/src/features/links/graph/linkGraphModel'
import { createSimulation } from '../../../src/renderer/src/features/links/graph/linkGraphSim'

const SIZE = { width: 1200, height: 800 }

function node(id: string): GraphNode {
  return { id, label: id, kind: 'pdf', descriptor: null, relPath: id }
}

function edge(sourceId: string, targetId: string): GraphEdge {
  return { id: `${sourceId}-${targetId}`, sourceId, targetId, kind: 'link' }
}

describe('createSimulation', () => {
  test('is deterministic — same ticks, same coordinates', () => {
    const nodes = [node('a'), node('b'), node('c')]
    const edges = [edge('a', 'b')]
    const first = createSimulation(nodes, edges, SIZE)
    const second = createSimulation(nodes, edges, SIZE)
    for (let index = 0; index < 50; index += 1) {
      first.tick(1)
      second.tick(1)
    }
    expect([...first.positions.entries()]).toEqual([
      ...second.positions.entries()
    ])
  })

  test('keeps every node finite and inside the padded canvas', () => {
    const nodes = Array.from({ length: 20 }, (_, index) => node(`n${index}`))
    const sim = createSimulation(nodes, [], SIZE)
    for (let index = 0; index < 120; index += 1) sim.tick(1)
    for (const point of sim.positions.values()) {
      expect(Number.isFinite(point.x)).toBe(true)
      expect(Number.isFinite(point.y)).toBe(true)
      expect(point.x).toBeGreaterThanOrEqual(0)
      expect(point.x).toBeLessThanOrEqual(SIZE.width)
      expect(point.y).toBeGreaterThanOrEqual(0)
      expect(point.y).toBeLessThanOrEqual(SIZE.height)
    }
  })

  test('a pinned node stays put while its neighbors keep springing', () => {
    const nodes = [node('a'), node('b')]
    const sim = createSimulation(nodes, [edge('a', 'b')], SIZE)
    sim.pin('a', 100, 100)
    const before = { ...sim.positions.get('b')! }
    for (let index = 0; index < 30; index += 1) sim.tick(1)

    expect(sim.positions.get('a')).toEqual({ x: 100, y: 100 })
    expect(sim.isPinned('a')).toBe(true)
    const after = sim.positions.get('b')!
    expect(after.x !== before.x || after.y !== before.y).toBe(true)
  })

  test('alpha 0 freezes the whole simulation', () => {
    const sim = createSimulation([node('a'), node('b')], [], SIZE)
    const snapshot = [...sim.positions.entries()].map(([id, point]) => [
      id,
      { ...point }
    ])
    sim.tick(0)
    expect([...sim.positions.entries()]).toEqual(snapshot)
  })
})
