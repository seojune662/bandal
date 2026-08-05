import type { CSSProperties } from 'react'
import type {
  MaterialKind,
  MaterialNode,
  MaterialSearchHit
} from '../../../../shared/types/materials'
import { Icon, type IconName } from '../../app/icons'
import { openMaterialInWorkspace } from '../workspace/openMaterial'

function iconForKind(kind: MaterialKind | 'dir', expanded = false): IconName {
  switch (kind) {
    case 'dir':
      return expanded ? 'folderOpen' : 'folder'
    case 'pdf':
      return 'filePdf'
    case 'note':
      return 'fileText'
    case 'image':
      return 'fileImage'
    default:
      return 'file'
  }
}

function openMaterial(kind: MaterialKind, relPath: string): void {
  openMaterialInWorkspace(kind, relPath)
}

/** pdf/md open as tabs; everything else opens in Finder (tooltip says so). */
function rowTitle(kind: MaterialKind | 'dir', relPath: string): string {
  if (kind === 'dir' || kind === 'pdf' || kind === 'note') return relPath
  return `${relPath} — Finder에서 열기`
}

interface TreeNodeProps {
  node: MaterialNode
  depth: number
  expandedPaths: Record<string, boolean>
  onToggleFolder: (relPath: string) => void
}

function TreeNode({
  node,
  depth,
  expandedPaths,
  onToggleFolder
}: TreeNodeProps): JSX.Element {
  const isDirectory = node.kind === 'dir'
  const expanded = isDirectory && expandedPaths[node.relPath] === true
  const rowStyle = { '--tree-depth': depth } as CSSProperties

  return (
    <li
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={isDirectory ? expanded : undefined}
    >
      <button
        type="button"
        className="material-row"
        data-kind={node.kind}
        style={rowStyle}
        title={rowTitle(node.kind, node.relPath)}
        onClick={() => {
          if (isDirectory) onToggleFolder(node.relPath)
        }}
        onDoubleClick={() => {
          if (!isDirectory && node.kind !== 'dir') {
            openMaterial(node.kind, node.relPath)
          }
        }}
      >
        <span
          className="material-row__chevron"
          data-visible={isDirectory}
          data-expanded={expanded}
        >
          <Icon name="chevronRight" />
        </span>
        <Icon
          name={iconForKind(node.kind, expanded)}
          className="material-row__type"
        />
        <span className="material-row__name">{node.name}</span>
      </button>
      {isDirectory && expanded && node.children !== undefined && (
        <ul role="group">
          {node.children.map((child) => (
            <TreeNode
              key={child.relPath}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              onToggleFolder={onToggleFolder}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

interface MaterialTreeProps {
  nodes: MaterialNode[]
  expandedPaths: Record<string, boolean>
  onToggleFolder: (relPath: string) => void
}

export function MaterialTree({
  nodes,
  expandedPaths,
  onToggleFolder
}: MaterialTreeProps): JSX.Element {
  return (
    <ul className="material-tree" role="tree" aria-label="자료 파일 트리">
      {nodes.map((node) => (
        <TreeNode
          key={node.relPath}
          node={node}
          depth={0}
          expandedPaths={expandedPaths}
          onToggleFolder={onToggleFolder}
        />
      ))}
    </ul>
  )
}

interface MaterialSearchResultsProps {
  results: MaterialSearchHit[]
}

export function MaterialSearchResults({
  results
}: MaterialSearchResultsProps): JSX.Element {
  return (
    <ul className="material-results" aria-label="자료 검색 결과">
      {results.map((result) => (
        <li key={result.relPath}>
          <button
            type="button"
            className="material-result"
            data-kind={result.kind}
            title={rowTitle(result.kind, result.relPath)}
            onDoubleClick={() => openMaterial(result.kind, result.relPath)}
          >
            <Icon
              name={iconForKind(result.kind)}
              className="material-row__type"
            />
            <span>
              <strong>{result.name}</strong>
              <small>{result.relPath}</small>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
