import type { MaterialNode, MaterialSearchHit } from '../../../../shared/types/materials'
import { findMaterialNode } from './materialPaths'

export function materialWithinRoot(path: string, root: string): boolean { return root === '' || path === root || path.startsWith(`${root}/`) }
export function workspaceMaterialTree(nodes: MaterialNode[], root: string): MaterialNode[] {
  if (!root) return nodes
  const node = findMaterialNode(nodes, root)
  return node?.kind === 'dir' ? node.children ?? [] : []
}
export function workspaceSearchResults(hits: MaterialSearchHit[], root: string): MaterialSearchHit[] { return hits.filter(hit => materialWithinRoot(hit.relPath, root)) }
export function workspaceDestination(path: string, root: string): string { return materialWithinRoot(path, root) ? path : root }
