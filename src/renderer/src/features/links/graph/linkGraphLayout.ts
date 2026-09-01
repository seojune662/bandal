/**
 * 의존성 없는 결정적 force-directed 레이아웃.
 *
 * Math.random 을 쓰지 않는다 — 초기 배치는 id 정렬 원형 + FNV-1a 해시 지터라
 * 같은 그래프는 항상 같은 그림이 된다(스냅샷 테스트 가능, 열 때마다 노드가
 * 다른 자리로 튀지 않음). 시뮬레이션은 rAF 없이 한 번에 수렴시킨다:
 * N < 300 가정에서 O(N²)·200틱은 수십 ms 로, 오버레이 여는 순간 1회 비용.
 */

import type { GraphEdge, GraphNode } from './linkGraphModel'

export interface GraphPoint {
  x: number
  y: number
}

interface LayoutOptions {
  width: number
  height: number
}

const TICKS = 200
const DAMPING = 0.85
const REPULSION = 6000
const SPRING_LENGTH = 110
const SPRING_STRENGTH = 0.02
const CENTER_PULL = 0.005
const MAX_STEP = 24
const MIN_DISTANCE = 0.01

/** FNV-1a — 결정적 지터 시드. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function jitter(id: string, salt: string): number {
  // [-0.5, 0.5) 결정적 난수 대용.
  return hashString(`${id}:${salt}`) / 0xffffffff - 0.5
}

export function layoutGraph(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  { width, height }: LayoutOptions
): Map<string, GraphPoint> {
  const positions = new Map<string, GraphPoint>()
  if (nodes.length === 0) return positions

  const centerX = width / 2
  const centerY = height / 2
  const radius = Math.min(width, height) * 0.35

  const ordered = [...nodes].sort((a, b) => a.id.localeCompare(b.id))
  ordered.forEach((node, index) => {
    const angle = (index / ordered.length) * Math.PI * 2
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * radius + jitter(node.id, 'x') * 40,
      y: centerY + Math.sin(angle) * radius + jitter(node.id, 'y') * 40
    })
  })

  const velocities = new Map<string, GraphPoint>(
    ordered.map((node) => [node.id, { x: 0, y: 0 }])
  )

  for (let tick = 0; tick < TICKS; tick += 1) {
    const forces = new Map<string, GraphPoint>(
      ordered.map((node) => [node.id, { x: 0, y: 0 }])
    )

    // 전 쌍 반발
    for (let a = 0; a < ordered.length; a += 1) {
      for (let b = a + 1; b < ordered.length; b += 1) {
        const nodeA = ordered[a]!
        const nodeB = ordered[b]!
        const pa = positions.get(nodeA.id)!
        const pb = positions.get(nodeB.id)!
        let dx = pa.x - pb.x
        let dy = pa.y - pb.y
        let distance = Math.hypot(dx, dy)
        if (distance < MIN_DISTANCE) {
          // 겹친 노드는 해시 기반 미소 벡터로 갈라놓는다(NaN 방지).
          dx = jitter(nodeA.id, `${tick}`) + 0.01
          dy = jitter(nodeB.id, `${tick}`) + 0.01
          distance = Math.hypot(dx, dy)
        }
        const force = REPULSION / (distance * distance)
        const fx = (dx / distance) * force
        const fy = (dy / distance) * force
        const forceA = forces.get(nodeA.id)!
        const forceB = forces.get(nodeB.id)!
        forceA.x += fx
        forceA.y += fy
        forceB.x -= fx
        forceB.y -= fy
      }
    }

    // 엣지 스프링
    for (const edge of edges) {
      const pa = positions.get(edge.sourceId)
      const pb = positions.get(edge.targetId)
      if (pa === undefined || pb === undefined) continue
      const dx = pb.x - pa.x
      const dy = pb.y - pa.y
      const distance = Math.max(Math.hypot(dx, dy), MIN_DISTANCE)
      const stretch = (distance - SPRING_LENGTH) * SPRING_STRENGTH
      const fx = (dx / distance) * stretch
      const fy = (dy / distance) * stretch
      const forceA = forces.get(edge.sourceId)
      const forceB = forces.get(edge.targetId)
      if (forceA !== undefined) {
        forceA.x += fx
        forceA.y += fy
      }
      if (forceB !== undefined) {
        forceB.x -= fx
        forceB.y -= fy
      }
    }

    // 약한 중심 인력(고립 노드가 날아가지 않게) + 적분
    for (const node of ordered) {
      const position = positions.get(node.id)!
      const velocity = velocities.get(node.id)!
      const force = forces.get(node.id)!
      force.x += (centerX - position.x) * CENTER_PULL
      force.y += (centerY - position.y) * CENTER_PULL

      velocity.x = (velocity.x + force.x) * DAMPING
      velocity.y = (velocity.y + force.y) * DAMPING
      const step = Math.hypot(velocity.x, velocity.y)
      const scale = step > MAX_STEP ? MAX_STEP / step : 1
      position.x += velocity.x * scale
      position.y += velocity.y * scale
    }
  }

  // 결과를 화면 안으로 정규화(fit) — 패딩 40px.
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of positions.values()) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  const padding = 40
  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)
  const scale = Math.min(
    (width - padding * 2) / spanX,
    (height - padding * 2) / spanY,
    1
  )
  for (const point of positions.values()) {
    point.x = centerX + (point.x - (minX + spanX / 2)) * scale
    point.y = centerY + (point.y - (minY + spanY / 2)) * scale
  }

  return positions
}
