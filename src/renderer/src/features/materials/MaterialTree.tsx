import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type {
  MaterialKind,
  MaterialNode,
  MaterialSearchHit
} from '../../../../shared/types/materials'
import { Icon, type IconName } from '../../app/icons'
import { openMaterialInWorkspace } from '../workspace/openMaterial'
import { writeMaterialImageDragData } from './imageDrag'

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

/** pdf/md open as tabs; everything else opens in Finder (tooltip says so). */
function rowTitle(kind: MaterialKind | 'dir', relPath: string): string {
  if (kind === 'dir' || kind === 'pdf' || kind === 'note') return relPath
  return `${relPath} — Finder에서 열기`
}

function focusAdjacentRow(
  event: React.KeyboardEvent<HTMLButtonElement>,
  direction: -1 | 1
): void {
  const container = event.currentTarget.closest<HTMLElement>(
    '.material-tree, .material-results'
  )
  if (container === null) return
  const rows = Array.from(
    container.querySelectorAll<HTMLButtonElement>('[data-material-row="true"]')
  )
  const index = rows.indexOf(event.currentTarget)
  const next = rows[index + direction]
  if (next === undefined) return
  event.preventDefault()
  next.focus()
}

interface InlineNameEditorProps {
  node: MaterialNode
  onCancel: () => void
  onRename: (newName: string) => Promise<string | null>
}

function InlineNameEditor({
  node,
  onCancel,
  onRename
}: InlineNameEditorProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(node.name)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const input = inputRef.current
      if (input === null) return
      input.focus()
      const extensionStart = node.kind === 'dir' ? -1 : node.name.lastIndexOf('.')
      input.setSelectionRange(0, extensionStart > 0 ? extensionStart : node.name.length)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [node.kind, node.name])

  const submit = async (): Promise<void> => {
    if (pending) return
    if (draft === node.name) {
      onCancel()
      return
    }
    setPending(true)
    setError(null)
    const renameError = await onRename(draft)
    if (renameError !== null) {
      setError(renameError)
      setPending(false)
    }
  }

  return (
    <input
      ref={inputRef}
      className="material-row__rename"
      value={draft}
      disabled={pending}
      aria-label={`${node.name} 이름 변경`}
      aria-invalid={error === null ? undefined : true}
      title={error ?? undefined}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (!pending && error === null) onCancel()
      }}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          event.preventDefault()
          void submit()
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
    />
  )
}

interface TreeNodeProps {
  node: MaterialNode
  depth: number
  expandedPaths: Record<string, boolean>
  editingRelPath: string | null
  selectedRelPath: string | null
  pasteTargetDirRelPath: string | null
  onToggleFolder: (relPath: string) => void
  onSelect: (node: MaterialNode) => void
  onContextMenu: (event: React.MouseEvent, node: MaterialNode) => void
  onCancelRename: () => void
  onRename: (node: MaterialNode, newName: string) => Promise<string | null>
}

function TreeNode({
  node,
  depth,
  expandedPaths,
  editingRelPath,
  selectedRelPath,
  pasteTargetDirRelPath,
  onToggleFolder,
  onSelect,
  onContextMenu,
  onCancelRename,
  onRename
}: TreeNodeProps): JSX.Element {
  const isDirectory = node.kind === 'dir'
  const expanded = isDirectory && expandedPaths[node.relPath] === true
  const editing = editingRelPath === node.relPath
  const rowStyle = { '--tree-depth': depth } as CSSProperties
  const rowContents = (
    <>
      <span
        className="material-row__chevron"
        data-visible={isDirectory}
        data-expanded={expanded}
      >
        <Icon name="chevronRight" />
      </span>
      <Icon name={iconForKind(node.kind, expanded)} className="material-row__type" />
      {editing ? (
        <InlineNameEditor
          node={node}
          onCancel={onCancelRename}
          onRename={(newName) => onRename(node, newName)}
        />
      ) : (
        <span className="material-row__name">{node.name}</span>
      )}
    </>
  )

  return (
    <li
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={isDirectory ? expanded : undefined}
    >
      {editing ? (
        <div
          className="material-row"
          data-kind={node.kind}
          data-selected={selectedRelPath === node.relPath || undefined}
          data-paste-target={
            isDirectory && pasteTargetDirRelPath === node.relPath
              ? true
              : undefined
          }
          data-material-path={node.relPath}
          style={rowStyle}
        >
          {rowContents}
        </div>
      ) : (
        <button
          type="button"
          className="material-row"
          draggable={node.kind === 'image'}
          data-material-row="true"
          data-kind={node.kind}
          data-selected={selectedRelPath === node.relPath || undefined}
          data-paste-target={
            isDirectory && pasteTargetDirRelPath === node.relPath
              ? true
              : undefined
          }
          data-material-path={node.relPath}
          style={rowStyle}
          title={rowTitle(node.kind, node.relPath)}
          onFocus={() => onSelect(node)}
          onClick={() => {
            onSelect(node)
            if (isDirectory) onToggleFolder(node.relPath)
            else if (node.kind !== 'dir') {
              openMaterialInWorkspace(node.kind, node.relPath)
            }
          }}
          onContextMenu={(event) => onContextMenu(event, node)}
          onDragStart={(event) => {
            if (node.kind !== 'image') return
            writeMaterialImageDragData(event.dataTransfer, {
              relPath: node.relPath,
              label: node.name
            })
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') focusAdjacentRow(event, 1)
            if (event.key === 'ArrowUp') focusAdjacentRow(event, -1)
            if (isDirectory && event.key === 'ArrowRight' && !expanded) {
              event.preventDefault()
              onToggleFolder(node.relPath)
            }
            if (isDirectory && event.key === 'ArrowLeft' && expanded) {
              event.preventDefault()
              onToggleFolder(node.relPath)
            }
          }}
        >
          {rowContents}
        </button>
      )}
      {isDirectory && expanded && node.children !== undefined && (
        <ul role="group">
          {node.children.map((child) => (
            <TreeNode
              key={child.relPath}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              editingRelPath={editingRelPath}
              selectedRelPath={selectedRelPath}
              pasteTargetDirRelPath={pasteTargetDirRelPath}
              onToggleFolder={onToggleFolder}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              onCancelRename={onCancelRename}
              onRename={onRename}
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
  editingRelPath: string | null
  selectedRelPath: string | null
  pasteTargetDirRelPath: string | null
  onToggleFolder: (relPath: string) => void
  onSelect: (node: MaterialNode) => void
  onContextMenu: (event: React.MouseEvent, node: MaterialNode) => void
  onCancelRename: () => void
  onRename: (node: MaterialNode, newName: string) => Promise<string | null>
}

export function MaterialTree({
  nodes,
  expandedPaths,
  editingRelPath,
  selectedRelPath,
  pasteTargetDirRelPath,
  onToggleFolder,
  onSelect,
  onContextMenu,
  onCancelRename,
  onRename
}: MaterialTreeProps): JSX.Element {
  return (
    <ul className="material-tree" role="tree" aria-label="자료 파일 트리">
      {nodes.map((node) => (
        <TreeNode
          key={node.relPath}
          node={node}
          depth={0}
          expandedPaths={expandedPaths}
          editingRelPath={editingRelPath}
          selectedRelPath={selectedRelPath}
          pasteTargetDirRelPath={pasteTargetDirRelPath}
          onToggleFolder={onToggleFolder}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
          onCancelRename={onCancelRename}
          onRename={onRename}
        />
      ))}
    </ul>
  )
}

interface MaterialSearchResultsProps {
  results: MaterialSearchHit[]
  selectedRelPath: string | null
  onSelect: (node: MaterialNode) => void
  onContextMenu: (event: React.MouseEvent, node: MaterialNode) => void
}

export function MaterialSearchResults({
  results,
  selectedRelPath,
  onSelect,
  onContextMenu
}: MaterialSearchResultsProps): JSX.Element {
  return (
    <ul className="material-results" aria-label="자료 검색 결과">
      {results.map((result) => {
        const node: MaterialNode = {
          relPath: result.relPath,
          name: result.name,
          kind: result.kind
        }
        return (
          <li key={result.relPath}>
            <button
              type="button"
              className="material-result"
              draggable={result.kind === 'image'}
              data-material-row="true"
              data-kind={result.kind}
              data-selected={selectedRelPath === result.relPath || undefined}
              data-material-path={result.relPath}
              title={rowTitle(result.kind, result.relPath)}
              onFocus={() => onSelect(node)}
              onClick={() => {
                onSelect(node)
                openMaterialInWorkspace(result.kind, result.relPath)
              }}
              onContextMenu={(event) => onContextMenu(event, node)}
              onDragStart={(event) => {
                if (result.kind !== 'image') return
                writeMaterialImageDragData(event.dataTransfer, {
                  relPath: result.relPath,
                  label: result.name
                })
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') focusAdjacentRow(event, 1)
                if (event.key === 'ArrowUp') focusAdjacentRow(event, -1)
              }}
            >
              <Icon name={iconForKind(result.kind)} className="material-row__type" />
              <span>
                <strong>{result.name}</strong>
                <small>{result.relPath}</small>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
