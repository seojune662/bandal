import type { AnnotationBounds } from '../../../../shared/types/chatAnnotation'

export function intersectBounds(first: AnnotationBounds, second: AnnotationBounds): AnnotationBounds | null {
  const x = Math.max(first.x, second.x), y = Math.max(first.y, second.y)
  const width = Math.min(first.x + first.width, second.x + second.width) - x
  const height = Math.min(first.y + first.height, second.y + second.height) - y
  return width > 0 && height > 0 ? { x, y, width, height } : null
}
export function normalizeBounds(rect: AnnotationBounds, source: AnnotationBounds): AnnotationBounds {
  const clipped = intersectBounds(rect, source)
  if (!clipped) throw new Error('선택 영역이 원본 밖에 있어요.')
  return { x: (clipped.x - source.x) / source.width, y: (clipped.y - source.y) / source.height, width: clipped.width / source.width, height: clipped.height / source.height }
}
export function dragBounds(from: { x: number; y: number }, to: { x: number; y: number }): AnnotationBounds {
  return { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) }
}
export function unionBounds(rects: AnnotationBounds[]): AnnotationBounds | null {
  if (!rects.length) return null
  const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y))
  return { x, y, width: Math.max(...rects.map(r => r.x + r.width)) - x, height: Math.max(...rects.map(r => r.y + r.height)) - y }
}
export function sourceFingerprint(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(36)
}
