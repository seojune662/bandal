import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type {
  MaterialKind,
  MaterialNode,
  MaterialSearchHit
} from '../../../../shared/types/materials'
import { Icon, type IconName } from '../../app/icons'
import { openMaterialInWorkspace } from '../workspace/openMaterial'
import { writeMaterialImageDragData } from './imageDrag'
import { isFileDrag } from './importDrop'
import {
  MATERIAL_MOVE_MIME,
  canAcceptMaterialMove,
  clearCurrentMaterialDrag,
  getCurrentMaterialDrag,
  parseMaterialMoveDrag,
  serializeMaterialMoveDrag,
  setCurrentMaterialDrag,
  type MaterialMoveDragPayload
} from './materialMoveDrag'
import { canAcceptUrlDrop, urlFromDrop } from './urlDrop'

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

function canMoveToDirectory(
  payload: MaterialMoveDragPayload,
  courseId: string,
  dirRelPath: string
): boolean {
  if (payload.courseId !== courseId) return false
  if (payload.kind !== 'dir') return true
  return (
    dirRelPath !== payload.relPath &&
    !dirRelPath.startsWith(`${payload.relPath}/`)
  )
}

function canDropCurrentMaterial(
  dataTransfer: DataTransfer,
  courseId: string,
  dirRelPath: string
): boolean {
  if (!canAcceptMaterialMove([...dataTransfer.types])) return false
  const payload = getCurrentMaterialDrag()
  return (
    payload !== null && canMoveToDirectory(payload, courseId, dirRelPath)
  )
}

function startMaterialDrag(
  dataTransfer: DataTransfer,
  courseId: string,
  node: MaterialNode
): void {
  const payload: MaterialMoveDragPayload = {
    version: 1,
    courseId,
    relPath: node.relPath,
    kind: node.kind
  }
  dataTransfer.effectAllowed = 'copyMove'
  dataTransfer.setData(
    MATERIAL_MOVE_MIME,
    serializeMaterialMoveDrag({
      courseId: payload.courseId,
      relPath: payload.relPath,
      kind: payload.kind
    })
  )
  setCurrentMaterialDrag(payload)
  if (node.kind === 'image') {
    writeMaterialImageDragData(dataTransfer, {
      relPath: node.relPath,
      label: node.name
    })
  }
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
  courseId: string
  node: MaterialNode
  depth: number
  expandedPaths: Record<string, boolean>
  editingRelPath: string | null
  selectedRelPath: string | null
  pasteTargetDirRelPath: string | null
  dropTargetDirRelPath: string | null
  urlDropTargetDirRelPath: string | null
  downloadingDirRelPath: string | null
  onToggleFolder: (relPath: string) => void
  onSelect: (node: MaterialNode) => void
  onContextMenu: (event: React.MouseEvent, node: MaterialNode) => void
  onCancelRename: () => void
  onRename: (node: MaterialNode, newName: string) => Promise<string | null>
  onDropTargetChange: (dirRelPath: string | null) => void
  onUrlDropTargetChange: (dirRelPath: string | null) => void
  onMove: (payload: MaterialMoveDragPayload, toDirRelPath: string) => void
  onImportFiles: (files: File[], dirRelPath: string) => void
  onDownloadUrl: (url: string, dirRelPath: string) => void
}

function TreeNode({
  courseId,
  node,
  depth,
  expandedPaths,
  editingRelPath,
  selectedRelPath,
  pasteTargetDirRelPath,
  dropTargetDirRelPath,
  urlDropTargetDirRelPath,
  downloadingDirRelPath,
  onToggleFolder,
  onSelect,
  onContextMenu,
  onCancelRename,
  onRename,
  onDropTargetChange,
  onUrlDropTargetChange,
  onMove,
  onImportFiles,
  onDownloadUrl
}: TreeNodeProps): JSX.Element {
  const isDirectory = node.kind === 'dir'
  const expanded = isDirectory && expandedPaths[node.relPath] === true
  const editing = editingRelPath === node.relPath
  const downloading =
    isDirectory && downloadingDirRelPath === node.relPath
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
      {downloading && (
        <Icon
          name="refresh"
          className="material-row__download-spinner is-spinning"
        />
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
          data-move-target={
            isDirectory && dropTargetDirRelPath === node.relPath
              ? true
              : undefined
          }
          data-url-target={
            isDirectory && urlDropTargetDirRelPath === node.relPath
              ? true
              : undefined
          }
          data-downloading={downloading || undefined}
          aria-busy={downloading || undefined}
          data-material-path={node.relPath}
          style={rowStyle}
        >
          {rowContents}
        </div>
      ) : (
        <button
          type="button"
          className="material-row"
          draggable
          data-material-row="true"
          data-kind={node.kind}
          data-selected={selectedRelPath === node.relPath || undefined}
          data-paste-target={
            isDirectory && pasteTargetDirRelPath === node.relPath
              ? true
              : undefined
          }
          data-move-target={
            isDirectory && dropTargetDirRelPath === node.relPath
              ? true
              : undefined
          }
          data-url-target={
            isDirectory && urlDropTargetDirRelPath === node.relPath
              ? true
              : undefined
          }
          data-downloading={downloading || undefined}
          aria-busy={downloading || undefined}
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
            startMaterialDrag(event.dataTransfer, courseId, node)
          }}
          onDragEnd={() => {
            clearCurrentMaterialDrag()
            onDropTargetChange(null)
            onUrlDropTargetChange(null)
          }}
          onDragEnter={(event) => {
            if (!isDirectory) return
            const types = [...event.dataTransfer.types]
            if (canAcceptMaterialMove(types)) {
              event.stopPropagation()
              onUrlDropTargetChange(null)
              if (!canDropCurrentMaterial(event.dataTransfer, courseId, node.relPath)) {
                onDropTargetChange(null)
                return
              }
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              onDropTargetChange(node.relPath)
              return
            }
            if (isFileDrag(event.dataTransfer)) {
              event.preventDefault()
              event.stopPropagation()
              event.dataTransfer.dropEffect = 'copy'
              onUrlDropTargetChange(null)
              onDropTargetChange(node.relPath)
              return
            }
            if (!canAcceptUrlDrop(types) || downloadingDirRelPath !== null) return
            event.preventDefault()
            event.stopPropagation()
            event.dataTransfer.dropEffect = 'copy'
            onDropTargetChange(null)
            onUrlDropTargetChange(node.relPath)
          }}
          onDragOver={(event) => {
            if (!isDirectory) return
            const types = [...event.dataTransfer.types]
            if (canAcceptMaterialMove(types)) {
              event.stopPropagation()
              onUrlDropTargetChange(null)
              if (!canDropCurrentMaterial(event.dataTransfer, courseId, node.relPath)) {
                onDropTargetChange(null)
                return
              }
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              onDropTargetChange(node.relPath)
              return
            }
            if (isFileDrag(event.dataTransfer)) {
              event.preventDefault()
              event.stopPropagation()
              event.dataTransfer.dropEffect = 'copy'
              onUrlDropTargetChange(null)
              onDropTargetChange(node.relPath)
              return
            }
            if (!canAcceptUrlDrop(types) || downloadingDirRelPath !== null) return
            event.preventDefault()
            event.stopPropagation()
            event.dataTransfer.dropEffect = 'copy'
            onDropTargetChange(null)
            onUrlDropTargetChange(node.relPath)
          }}
          onDragLeave={(event) => {
            if (!isDirectory) return
            const types = [...event.dataTransfer.types]
            const handlesFiles = isFileDrag(event.dataTransfer)
            const handlesMove = canAcceptMaterialMove(types)
            const handlesUrl = canAcceptUrlDrop(types)
            if (!handlesMove && !handlesFiles && !handlesUrl) return
            event.stopPropagation()
            const nextTarget = event.relatedTarget
            if (
              nextTarget instanceof Node &&
              event.currentTarget.contains(nextTarget)
            ) {
              return
            }
            onDropTargetChange(null)
            onUrlDropTargetChange(null)
          }}
          onDrop={(event) => {
            if (!isDirectory) return
            const types = [...event.dataTransfer.types]
            if (canAcceptMaterialMove(types)) {
              event.preventDefault()
              event.stopPropagation()
              onDropTargetChange(null)
              onUrlDropTargetChange(null)
              const payload = parseMaterialMoveDrag(
                event.dataTransfer.getData(MATERIAL_MOVE_MIME)
              )
              if (
                payload === null ||
                !canMoveToDirectory(payload, courseId, node.relPath)
              ) {
                return
              }
              onMove(payload, node.relPath)
              return
            }
            if (isFileDrag(event.dataTransfer)) {
              event.preventDefault()
              event.stopPropagation()
              onDropTargetChange(null)
              onUrlDropTargetChange(null)
              const files = [...event.dataTransfer.files]
              if (files.length > 0) onImportFiles(files, node.relPath)
              return
            }
            if (!canAcceptUrlDrop(types) || downloadingDirRelPath !== null) return
            event.preventDefault()
            event.stopPropagation()
            onDropTargetChange(null)
            onUrlDropTargetChange(null)
            const url = urlFromDrop(event.dataTransfer)
            if (url !== null) onDownloadUrl(url, node.relPath)
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
              courseId={courseId}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              editingRelPath={editingRelPath}
              selectedRelPath={selectedRelPath}
              pasteTargetDirRelPath={pasteTargetDirRelPath}
              dropTargetDirRelPath={dropTargetDirRelPath}
              urlDropTargetDirRelPath={urlDropTargetDirRelPath}
              downloadingDirRelPath={downloadingDirRelPath}
              onToggleFolder={onToggleFolder}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              onCancelRename={onCancelRename}
              onRename={onRename}
              onDropTargetChange={onDropTargetChange}
              onUrlDropTargetChange={onUrlDropTargetChange}
              onMove={onMove}
              onImportFiles={onImportFiles}
              onDownloadUrl={onDownloadUrl}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

interface MaterialTreeProps {
  courseId: string
  nodes: MaterialNode[]
  expandedPaths: Record<string, boolean>
  editingRelPath: string | null
  selectedRelPath: string | null
  pasteTargetDirRelPath: string | null
  dropTargetDirRelPath: string | null
  urlDropTargetDirRelPath: string | null
  downloadingDirRelPath: string | null
  onToggleFolder: (relPath: string) => void
  onSelect: (node: MaterialNode) => void
  onContextMenu: (event: React.MouseEvent, node: MaterialNode) => void
  onCancelRename: () => void
  onRename: (node: MaterialNode, newName: string) => Promise<string | null>
  onDropTargetChange: (dirRelPath: string | null) => void
  onUrlDropTargetChange: (dirRelPath: string | null) => void
  onMove: (payload: MaterialMoveDragPayload, toDirRelPath: string) => void
  onImportFiles: (files: File[], dirRelPath: string) => void
  onDownloadUrl: (url: string, dirRelPath: string) => void
}

export function MaterialTree({
  courseId,
  nodes,
  expandedPaths,
  editingRelPath,
  selectedRelPath,
  pasteTargetDirRelPath,
  dropTargetDirRelPath,
  urlDropTargetDirRelPath,
  downloadingDirRelPath,
  onToggleFolder,
  onSelect,
  onContextMenu,
  onCancelRename,
  onRename,
  onDropTargetChange,
  onUrlDropTargetChange,
  onMove,
  onImportFiles,
  onDownloadUrl
}: MaterialTreeProps): JSX.Element {
  return (
    <ul className="material-tree" role="tree" aria-label="자료 파일 트리">
      {nodes.map((node) => (
        <TreeNode
          key={node.relPath}
          courseId={courseId}
          node={node}
          depth={0}
          expandedPaths={expandedPaths}
          editingRelPath={editingRelPath}
          selectedRelPath={selectedRelPath}
          pasteTargetDirRelPath={pasteTargetDirRelPath}
          dropTargetDirRelPath={dropTargetDirRelPath}
          urlDropTargetDirRelPath={urlDropTargetDirRelPath}
          downloadingDirRelPath={downloadingDirRelPath}
          onToggleFolder={onToggleFolder}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
          onCancelRename={onCancelRename}
          onRename={onRename}
          onDropTargetChange={onDropTargetChange}
          onUrlDropTargetChange={onUrlDropTargetChange}
          onMove={onMove}
          onImportFiles={onImportFiles}
          onDownloadUrl={onDownloadUrl}
        />
      ))}
    </ul>
  )
}

interface MaterialSearchResultsProps {
  courseId: string
  results: MaterialSearchHit[]
  selectedRelPath: string | null
  onSelect: (node: MaterialNode) => void
  onContextMenu: (event: React.MouseEvent, node: MaterialNode) => void
  onDragEnd: () => void
}

export function MaterialSearchResults({
  courseId,
  results,
  selectedRelPath,
  onSelect,
  onContextMenu,
  onDragEnd
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
              draggable
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
                startMaterialDrag(event.dataTransfer, courseId, node)
              }}
              onDragEnd={() => {
                clearCurrentMaterialDrag()
                onDragEnd()
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
