import type { MaterialNode } from '../../../../shared/types/materials'
import type { MaterialSortOrder } from './materialViewPreference'

const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' })
export function materialTypeLabel(node: MaterialNode): string {
  if (node.kind === 'dir') return '폴더'
  if (node.kind === 'pdf') return 'PDF'
  if (node.kind === 'note') return '마크다운'
  if (node.kind === 'image') return '이미지'
  if (node.kind === 'video') return '영상'
  return node.name.includes('.') ? node.name.split('.').at(-1)!.toUpperCase() : '파일'
}

export function materialTimestamp(node: MaterialNode): number {
  return typeof node.mtime === 'number' && Number.isFinite(node.mtime) && node.mtime > 0 && node.mtime <= 8.64e15 ? node.mtime : 0
}

export function sortMaterials(nodes: MaterialNode[], order: MaterialSortOrder): MaterialNode[] {
  return [...nodes].sort((a, b) => {
    if ((a.kind === 'dir') !== (b.kind === 'dir')) return a.kind === 'dir' ? -1 : 1
    const primary = order === 'modified' ? materialTimestamp(b) - materialTimestamp(a)
      : order === 'kind' ? collator.compare(materialTypeLabel(a), materialTypeLabel(b)) : 0
    return primary || collator.compare(a.name, b.name) || a.relPath.localeCompare(b.relPath)
  }).map(node => node.children ? { ...node, children: sortMaterials(node.children, order) } : node)
}
