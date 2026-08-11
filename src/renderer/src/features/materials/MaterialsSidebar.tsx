import { useCallback, useEffect, useRef, useState } from 'react'
import type { Course } from '../../../../shared/types/course'
import type { MaterialNode } from '../../../../shared/types/materials'
import { Icon } from '../../app/icons'
import { Tooltip } from '../../components/Tooltip'
import { invoke, onPush } from '../../lib/ipc'
import { showToast } from '../../app/toast'
import { useCoursesStore } from '../../stores/coursesStore'
import { useMaterialsStore } from '../../stores/materialsStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { normalizeCourseColor } from '../courses/courseColors'
import { CourseGroupsSection } from '../group/CourseGroupsSection'
import { openMaterialInWorkspace } from '../workspace/openMaterial'
import { descriptorFor, tabPanelId } from '../workspace/tabIdentity'
import { MaterialDeleteDialog } from './MaterialDeleteDialog'
import { MaterialSearchResults, MaterialTree } from './MaterialTree'
import {
  MaterialsContextMenu,
  type MaterialsContextMenuState
} from './MaterialsContextMenu'
import {
  absoluteMaterialPath,
  findMaterialNode,
  kindForMaterialName,
  materialBaseName,
  materialParentPath,
  targetDirectory,
  unusedFolderName
} from './materialPaths'
import { isEditablePasteTarget } from './clipboardPaste'
import { importDroppedFiles, isFileDrag } from './importDrop'
import { MaterialsIcon } from './materialIcons'
import {
  MATERIAL_MOVE_MIME,
  canAcceptMaterialMove,
  getCurrentMaterialDrag,
  parseMaterialMoveDrag,
  type MaterialMoveDragPayload
} from './materialMoveDrag'
import { useMaterialsPaste } from './useMaterialsPaste'
import { WhiteboardsGroup } from './WhiteboardsGroup'
import './materials.css'

const SEARCH_DEBOUNCE_MS = 240

interface MaterialsSidebarProps {
  course: Course | null
}

interface EditingState {
  relPath: string
  /** New notes are already open before their first inline rename. */
  reopenAfterRename: boolean
}

function operationError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function pathIsTargetOrChild(path: string, target: string): boolean {
  return path === target || path.startsWith(`${target}/`)
}

function reconcileTabsAfterRename(
  courseId: string,
  node: MaterialNode,
  newRelPath: string,
  forceReopen: boolean
): void {
  const workspace = useWorkspaceStore.getState()
  let reopened = false
  for (const [panelId, descriptor] of Object.entries(workspace.openTabs)) {
    if (descriptor.kind !== 'pdf' && descriptor.kind !== 'note') continue
    if (descriptor.payload.courseId !== courseId) continue
    if (!pathIsTargetOrChild(descriptor.payload.relPath, node.relPath)) continue
    const suffix = descriptor.payload.relPath.slice(node.relPath.length)
    workspace.closeTab(panelId)
    const nextRelPath = `${newRelPath}${suffix}`
    const nextKind =
      node.kind === 'dir'
        ? descriptor.kind
        : kindForMaterialName(materialBaseName(nextRelPath))
    if (nextKind === 'pdf' || nextKind === 'note') {
      openMaterialInWorkspace(nextKind, nextRelPath)
    }
    reopened = true
  }

  if (node.kind !== 'dir') {
    const oldKind = node.kind
    if (oldKind === 'pdf' || oldKind === 'note') {
      workspace.closeTab(
        tabPanelId(descriptorFor(oldKind, { courseId, relPath: node.relPath }))
      )
    }
  }

  if (!reopened && forceReopen && node.kind !== 'dir') {
    const newKind = kindForMaterialName(materialBaseName(newRelPath))
    if (newKind === 'pdf' || newKind === 'note') {
      openMaterialInWorkspace(newKind, newRelPath)
    }
  }
}

function closeDeletedTabs(courseId: string, node: MaterialNode): void {
  const workspace = useWorkspaceStore.getState()
  for (const [panelId, descriptor] of Object.entries(workspace.openTabs)) {
    if (descriptor.kind !== 'pdf' && descriptor.kind !== 'note') continue
    if (
      descriptor.payload.courseId === courseId &&
      pathIsTargetOrChild(descriptor.payload.relPath, node.relPath)
    ) {
      workspace.closeTab(panelId)
    }
  }
  if (node.kind === 'pdf' || node.kind === 'note') {
    workspace.closeTab(
      tabPanelId(descriptorFor(node.kind, { courseId, relPath: node.relPath }))
    )
  }
}

export function MaterialsSidebar({ course }: MaterialsSidebarProps): JSX.Element {
  const tree = useMaterialsStore((state) => state.tree)
  const searchResults = useMaterialsStore((state) => state.searchResults)
  const expandedPaths = useMaterialsStore((state) => state.expandedPaths)
  const isLoading = useMaterialsStore((state) => state.isLoading)
  const isSearching = useMaterialsStore((state) => state.isSearching)
  const error = useMaterialsStore((state) => state.error)
  const loadTree = useMaterialsStore((state) => state.loadTree)
  const search = useMaterialsStore((state) => state.search)
  const clearSearch = useMaterialsStore((state) => state.clearSearch)
  const clear = useMaterialsStore((state) => state.clear)
  const toggleFolder = useMaterialsStore((state) => state.toggleFolder)
  const pickFolder = useCoursesStore((state) => state.pickFolder)
  const relinkCourse = useCoursesStore((state) => state.relinkCourse)
  const [query, setQuery] = useState('')
  const [isDebouncing, setIsDebouncing] = useState(false)
  const [isRelinking, setIsRelinking] = useState(false)
  const [contextMenu, setContextMenu] = useState<MaterialsContextMenuState | null>(
    null
  )
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [selectedRelPath, setSelectedRelPath] = useState<string | null>(null)
  const [pasteFocused, setPasteFocused] = useState(false)
  const [isDropActive, setDropActive] = useState(false)
  const [dropTargetDirRelPath, setDropTargetDirRelPath] = useState<string | null>(
    null
  )
  const [deleteTarget, setDeleteTarget] = useState<MaterialNode | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const closeContextMenu = useCallback(() => setContextMenu(null), [])
  const closeDeleteDialog = useCallback(() => {
    if (deletePending) return
    setDeleteTarget(null)
    setDeleteError(null)
  }, [deletePending])

  /** 연결 끊김 복구: re-pick the folder this course points at. */
  const relink = async (courseId: string): Promise<void> => {
    setIsRelinking(true)
    try {
      const picked = await pickFolder()
      if (picked === null) return
      const result = await relinkCourse(courseId, picked.path)
      if (result.status === 'ok') showToast('폴더를 다시 연결했어요.')
    } catch {
      // The course rail shows the store's persistent error message.
    } finally {
      setIsRelinking(false)
    }
  }

  // Re-runs when the course is re-linked too — folderPath is part of the key.
  useEffect(() => {
    setQuery('')
    setContextMenu(null)
    setEditing(null)
    setSelectedRelPath(null)
    setDropActive(false)
    setDropTargetDirRelPath(null)
    setDeleteTarget(null)
    setDeleteError(null)
    clearSearch()
    if (course === null || course.missing) {
      clear()
      return
    }
    void loadTree(course.id)
  }, [clear, clearSearch, course?.id, course?.folderPath, course?.missing, loadTree])

  // [M5] Live tree: watch the course folder, refresh silently on pushes.
  // A 연결 끊김 course has no folder to watch.
  useEffect(() => {
    if (course === null || course.missing) return
    const courseId = course.id
    void invoke('materials:watch', { courseId }).catch((error: unknown) => {
      console.error('[Bandal] 자료 폴더 감시를 시작하지 못했습니다.', error)
    })
    const unsubscribe = onPush('materials:changed', (payload) => {
      if (payload.courseId === courseId) {
        void loadTree(courseId, { silent: true })
      }
    })
    return () => {
      unsubscribe()
      void invoke('materials:unwatch', { courseId }).catch(() => undefined)
    }
  }, [course?.id, course?.folderPath, course?.missing, loadTree])

  useEffect(() => {
    const normalizedQuery = query.trim()
    if (course === null || normalizedQuery.length === 0) {
      setIsDebouncing(false)
      clearSearch()
      return
    }

    setIsDebouncing(true)
    const timeout = window.setTimeout(() => {
      setIsDebouncing(false)
      void search(course.id, normalizedQuery)
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [clearSearch, course, query, search])

  const searching = query.trim().length > 0
  const pendingSearch = isDebouncing || isSearching

  const ensureFolderExpanded = useCallback((dirRelPath: string): void => {
    if (dirRelPath === '') return
    const materials = useMaterialsStore.getState()
    if (materials.expandedPaths[dirRelPath] !== true) {
      materials.toggleFolder(dirRelPath)
    }
  }, [])

  const ensureAncestorsExpanded = useCallback(
    (relPath: string): void => {
      const segments = materialParentPath(relPath).split('/').filter(Boolean)
      let ancestor = ''
      for (const segment of segments) {
        ancestor = ancestor === '' ? segment : `${ancestor}/${segment}`
        ensureFolderExpanded(ancestor)
      }
    },
    [ensureFolderExpanded]
  )

  const handleCreated = useCallback(
    (relPaths: string[]): void => {
      const newest = relPaths.at(-1)
      if (newest === undefined) return
      ensureAncestorsExpanded(newest)
      setSelectedRelPath(newest)
    },
    [ensureAncestorsExpanded]
  )

  const selectedNode = findMaterialNode(tree, selectedRelPath)
  const pasteDirRelPath = targetDirectory(selectedNode)
  const pasteDestinationName =
    pasteDirRelPath === ''
      ? `${course?.name ?? '과목'} 루트`
      : `‘${materialBaseName(pasteDirRelPath)}’ 폴더`
  const { pasteNotice, isPasting, onPaste } = useMaterialsPaste({
    enabled: pasteFocused,
    courseId: course !== null && !course.missing ? course.id : null,
    courseName: course?.name ?? null,
    dirRelPath: pasteDirRelPath,
    destinationName: pasteDestinationName,
    onCreated: handleCreated
  })
  const pasteReady = pasteFocused && course !== null && !course.missing

  useEffect(() => {
    if (selectedRelPath === null) return
    const frame = window.requestAnimationFrame(() => {
      const rows = sidebarRef.current?.querySelectorAll<HTMLElement>(
        '[data-material-path]'
      )
      const row = Array.from(rows ?? []).find(
        (candidate) => candidate.dataset.materialPath === selectedRelPath
      )
      row?.scrollIntoView({ block: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [selectedRelPath, tree])

  const refreshAfterMutation = async (courseId: string): Promise<void> => {
    await useMaterialsStore.getState().loadTree(courseId)
  }

  const moveMaterial = async (
    payload: MaterialMoveDragPayload,
    toDirRelPath: string
  ): Promise<void> => {
    if (course === null || course.missing || payload.courseId !== course.id) return
    const node =
      findMaterialNode(useMaterialsStore.getState().tree, payload.relPath) ??
      ({
        relPath: payload.relPath,
        name: materialBaseName(payload.relPath),
        kind: payload.kind
      } satisfies MaterialNode)
    try {
      const moved = await invoke('materials:move', {
        courseId: course.id,
        fromRelPath: payload.relPath,
        toDirRelPath
      })
      reconcileTabsAfterRename(course.id, node, moved.relPath, false)
      setQuery('')
      clearSearch()
      await refreshAfterMutation(course.id)
      ensureAncestorsExpanded(moved.relPath)
      setSelectedRelPath(moved.relPath)
    } catch (moveError) {
      console.error('[Bandal] 자료를 이동하지 못했습니다.', moveError)
      showToast(operationError(moveError, '자료를 이동하지 못했습니다.'), 'danger')
    }
  }

  const importFiles = (files: File[], dirRelPath?: string): void => {
    setDropActive(false)
    setDropTargetDirRelPath(null)
    if (course === null || course.missing || files.length === 0) return
    void importDroppedFiles(course.id, files, dirRelPath).then(handleCreated)
  }

  const handleContextMenu = (
    event: React.MouseEvent,
    target: MaterialNode | null
  ): void => {
    if (course === null || course.missing) return
    event.preventDefault()
    event.stopPropagation()
    setEditing(null)
    setSelectedRelPath(target?.relPath ?? null)
    setContextMenu({
      target,
      x: event.clientX,
      y: event.clientY,
      placement: event.clientY > window.innerHeight / 2 ? 'top' : 'bottom',
      align: event.clientX > window.innerWidth / 2 ? 'end' : 'start',
      returnFocus: event.currentTarget as HTMLElement
    })
  }

  const writeClipboard = async (value: string): Promise<void> => {
    setContextMenu(null)
    try {
      await navigator.clipboard.writeText(value)
      showToast('경로를 복사했어요.')
    } catch (clipboardError) {
      console.error('[Bandal] 경로를 복사하지 못했습니다.', clipboardError)
      showToast('경로를 복사하지 못했습니다.', 'danger')
    }
  }

  const createFile = async (target: MaterialNode | null): Promise<void> => {
    if (course === null) return
    setContextMenu(null)
    const dirRelPath = targetDirectory(target)
    try {
      const created = await invoke('notes:create', {
        courseId: course.id,
        dirRelPath,
        title: '새 파일'
      })
      ensureAncestorsExpanded(created.relPath)
      openMaterialInWorkspace('note', created.relPath)
      await refreshAfterMutation(course.id)
      setSelectedRelPath(created.relPath)
      setEditing({ relPath: created.relPath, reopenAfterRename: true })
    } catch (createError) {
      console.error('[Bandal] 새 파일을 만들지 못했습니다.', createError)
      showToast('새 파일을 만들지 못했습니다.', 'danger')
    }
  }

  const createFolder = async (target: MaterialNode | null): Promise<void> => {
    if (course === null) return
    setContextMenu(null)
    const dirRelPath = targetDirectory(target)
    const name = unusedFolderName(useMaterialsStore.getState().tree, dirRelPath)
    try {
      const created = await invoke('materials:createFolder', {
        courseId: course.id,
        dirRelPath,
        name
      })
      ensureAncestorsExpanded(created.relPath)
      await refreshAfterMutation(course.id)
      setSelectedRelPath(created.relPath)
      setEditing({ relPath: created.relPath, reopenAfterRename: false })
    } catch (createError) {
      console.error('[Bandal] 새 폴더를 만들지 못했습니다.', createError)
      showToast('새 폴더를 만들지 못했습니다.', 'danger')
    }
  }

  const duplicate = async (target: MaterialNode): Promise<void> => {
    if (course === null) return
    setContextMenu(null)
    try {
      const duplicated = await invoke('materials:duplicate', {
        courseId: course.id,
        relPath: target.relPath
      })
      ensureAncestorsExpanded(duplicated.relPath)
      await refreshAfterMutation(course.id)
      setSelectedRelPath(duplicated.relPath)
      showToast('자료를 복제했어요.')
    } catch (duplicateError) {
      console.error('[Bandal] 자료를 복제하지 못했습니다.', duplicateError)
      showToast('자료를 복제하지 못했습니다.', 'danger')
    }
  }

  const reveal = async (target: MaterialNode): Promise<void> => {
    if (course === null) return
    setContextMenu(null)
    try {
      await invoke('materials:reveal', {
        courseId: course.id,
        relPath: target.relPath
      })
    } catch (revealError) {
      console.error('[Bandal] Finder에서 자료를 열지 못했습니다.', revealError)
      showToast('Finder에서 자료를 열지 못했습니다.', 'danger')
    }
  }

  const beginRename = (target: MaterialNode): void => {
    setContextMenu(null)
    setQuery('')
    clearSearch()
    ensureAncestorsExpanded(target.relPath)
    setEditing({ relPath: target.relPath, reopenAfterRename: false })
  }

  const rename = async (
    node: MaterialNode,
    newName: string
  ): Promise<string | null> => {
    if (course === null) return '과목을 선택하세요.'
    try {
      const renamed = await invoke('materials:rename', {
        courseId: course.id,
        relPath: node.relPath,
        newName
      })
      reconcileTabsAfterRename(
        course.id,
        node,
        renamed.relPath,
        editing?.reopenAfterRename === true
      )
      await refreshAfterMutation(course.id)
      setSelectedRelPath(renamed.relPath)
      setEditing(null)
      return null
    } catch (renameError) {
      const message = operationError(renameError, '이름을 변경하지 못했습니다.')
      console.error('[Bandal] 자료 이름을 변경하지 못했습니다.', renameError)
      showToast('이름을 변경하지 못했습니다.', 'danger')
      return message
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (course === null || deleteTarget === null) return
    setDeletePending(true)
    setDeleteError(null)
    try {
      await invoke('materials:delete', {
        courseId: course.id,
        relPath: deleteTarget.relPath
      })
      closeDeletedTabs(course.id, deleteTarget)
      await refreshAfterMutation(course.id)
      if (
        selectedRelPath !== null &&
        pathIsTargetOrChild(selectedRelPath, deleteTarget.relPath)
      ) {
        setSelectedRelPath(null)
      }
      setDeleteTarget(null)
      showToast('휴지통으로 이동했어요.')
    } catch (deleteFailure) {
      setDeleteError(operationError(deleteFailure, '휴지통으로 이동하지 못했습니다.'))
    } finally {
      setDeletePending(false)
    }
  }

  return (
    <aside
      ref={sidebarRef}
      className="app-rail app-rail--right"
      role="region"
      tabIndex={0}
      aria-label="자료 사이드바. 포커스한 뒤 Command V로 자료 붙여넣기"
      data-drop-active={isDropActive || undefined}
      data-paste-ready={pasteReady || undefined}
      data-pasting={isPasting || undefined}
      onPaste={onPaste}
      onFocusCapture={(event) => {
        setPasteFocused(!isEditablePasteTarget(event.target))
      }}
      onBlurCapture={(event) => {
        const next = event.relatedTarget
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
          setPasteFocused(false)
        }
      }}
      onMouseDown={(event) => {
        const target = event.target as HTMLElement
        if (
          target.closest('button, input, textarea, a, [contenteditable="true"]') ===
          null
        ) {
          setSelectedRelPath(null)
          event.currentTarget.focus()
        }
      }}
      onDragEnterCapture={(event) => {
        if (course === null || course.missing || !isFileDrag(event.dataTransfer)) {
          return
        }
        event.preventDefault()
        setDropActive(true)
      }}
      onDragOverCapture={(event) => {
        if (course === null || course.missing || !isFileDrag(event.dataTransfer)) {
          return
        }
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setDropActive(true)
      }}
      onDragLeaveCapture={(event) => {
        if (!isFileDrag(event.dataTransfer)) return
        const nextTarget = event.relatedTarget
        if (
          nextTarget instanceof Node &&
          event.currentTarget.contains(nextTarget)
        ) {
          return
        }
        setDropActive(false)
        setDropTargetDirRelPath(null)
      }}
      onDrop={(event) => {
        if (course === null || course.missing || !isFileDrag(event.dataTransfer)) {
          return
        }
        event.preventDefault()
        importFiles([...event.dataTransfer.files])
      }}
    >
      <div className="rail-heading materials-heading">
        <div className="materials-heading__text">
          <p className="eyebrow">MATERIALS</p>
          <h2>자료</h2>
          {course !== null && (
            <span className="materials-heading__course">
              <span
                className="course-dot"
                data-course-color={normalizeCourseColor(course.color)}
              />
              {course.name}
            </span>
          )}
        </div>
        <div className="materials-heading__actions">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              if (course === null || course.missing) return
              const input = event.currentTarget
              const files = Array.from(input.files ?? [])
              input.value = ''
              if (files.length === 0) return
              void importDroppedFiles(course.id, files).then(handleCreated)
            }}
          />
          <Tooltip label="자료 가져오기">
            <button
              type="button"
              className="bare-icon-button"
              data-tour="materials-import"
              aria-label="자료 가져오기"
              disabled={course === null || course.missing || isPasting}
              onClick={() => fileInputRef.current?.click()}
            >
              <MaterialsIcon name="fileImport" />
            </button>
          </Tooltip>
          <Tooltip label="새 폴더 만들기">
            <button
              type="button"
              className="bare-icon-button"
              aria-label="새 폴더 만들기"
              disabled={course === null || course.missing || isPasting}
              onClick={() => void createFolder(selectedNode)}
            >
              <MaterialsIcon name="folderPlus" />
            </button>
          </Tooltip>
          <Tooltip label="자료 새로고침">
            <button
              type="button"
              className="bare-icon-button"
              aria-label="자료 새로고침"
              disabled={course === null || isLoading}
              onClick={() => {
                if (course !== null) void loadTree(course.id)
              }}
            >
              <Icon name="refresh" className={isLoading ? 'is-spinning' : ''} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="rail-search">
        <Icon name="search" className="rail-search__icon" />
        <label className="sr-only" htmlFor="material-search">
          파일 검색
        </label>
        <input
          id="material-search"
          type="search"
          placeholder="Find files"
          value={query}
          disabled={course === null}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query.length > 0 && (
          <button
            type="button"
            className="rail-search__clear"
            aria-label="검색어 지우기"
            onClick={() => setQuery('')}
          >
            <Icon name="x" />
          </button>
        )}
      </div>

      {error !== null && (
        <div className="rail-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              if (course === null) return
              if (searching) void search(course.id, query)
              else void loadTree(course.id)
            }}
          >
            다시 시도
          </button>
        </div>
      )}

      <div
        className="app-rail__body materials-body"
        data-paste-target-root={
          pasteReady && pasteDirRelPath === '' ? true : undefined
        }
        data-move-target-root={dropTargetDirRelPath === '' || undefined}
        onDragEnter={(event) => {
          if (event.target !== event.currentTarget) return
          if (!canAcceptMaterialMove([...event.dataTransfer.types])) return
          const payload = getCurrentMaterialDrag()
          if (payload === null || payload.courseId !== course?.id) return
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = 'move'
          setDropTargetDirRelPath('')
        }}
        onDragOver={(event) => {
          if (event.target !== event.currentTarget) return
          if (!canAcceptMaterialMove([...event.dataTransfer.types])) return
          const payload = getCurrentMaterialDrag()
          if (payload === null || payload.courseId !== course?.id) return
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = 'move'
          setDropTargetDirRelPath('')
        }}
        onDragLeave={(event) => {
          if (event.target !== event.currentTarget) return
          if (!canAcceptMaterialMove([...event.dataTransfer.types])) return
          event.stopPropagation()
          setDropTargetDirRelPath(null)
        }}
        onDrop={(event) => {
          if (event.target !== event.currentTarget) return
          if (!canAcceptMaterialMove([...event.dataTransfer.types])) return
          event.preventDefault()
          event.stopPropagation()
          setDropTargetDirRelPath(null)
          const payload = parseMaterialMoveDrag(
            event.dataTransfer.getData(MATERIAL_MOVE_MIME)
          )
          if (payload !== null && payload.courseId === course?.id) {
            void moveMaterial(payload, '')
          }
        }}
      >
        {pasteNotice !== null && (
          <div className="materials-paste-notice" role="status">
            <MaterialsIcon name="fileImport" />
            <span>{pasteNotice}</span>
          </div>
        )}
        {course === null ? (
          <div className="empty-state empty-state--materials">
            <Icon name="folder" className="empty-state__folder" />
            <p className="empty-state__text">과목을 선택하세요</p>
            <p className="empty-state__hint">선택한 과목의 자료가 여기에 표시됩니다.</p>
          </div>
        ) : (
          <>
            <WhiteboardsGroup courseId={course.id} />
            <section
              className="materials-files-group"
              aria-label="자료 파일"
              onContextMenu={(event) => handleContextMenu(event, null)}
            >
              <div className="materials-group-heading">
                <span>파일</span>
              </div>
              {course.missing ? (
                <div className="empty-state empty-state--materials">
                  <Icon name="folder" className="empty-state__folder" />
                  <p className="empty-state__text">폴더 연결이 끊겼어요</p>
                  <p className="empty-state__hint" title={course.folderPath}>
                    {course.folderPath} 을(를) 찾을 수 없어요. 폴더를 옮겼다면 다시
                    연결해주세요.
                  </p>
                  <button
                    type="button"
                    className="button button--primary"
                    disabled={isRelinking}
                    onClick={() => void relink(course.id)}
                  >
                    <Icon name="link" />
                    {isRelinking ? '연결 중…' : '다시 연결'}
                  </button>
                </div>
              ) : pendingSearch || (isLoading && !searching) ? (
                <div className="loading-list" aria-label="자료 불러오는 중">
                  <span />
                  <span />
                  <span />
                </div>
              ) : searching ? (
                searchResults.length === 0 ? (
                  <div className="rail-zero-result">
                    <p>일치하는 자료가 없어요</p>
                    <button type="button" onClick={() => setQuery('')}>
                      전체 자료 보기
                    </button>
                  </div>
                ) : (
                  <MaterialSearchResults
                    courseId={course.id}
                    results={searchResults}
                    selectedRelPath={selectedRelPath}
                    onSelect={(node) => setSelectedRelPath(node.relPath)}
                    onContextMenu={handleContextMenu}
                    onDragEnd={() => setDropTargetDirRelPath(null)}
                  />
                )
              ) : tree.length === 0 ? (
                <div className="empty-state empty-state--materials">
                  <Icon name="folder" className="empty-state__folder" />
                </div>
              ) : (
                <MaterialTree
                  courseId={course.id}
                  nodes={tree}
                  expandedPaths={expandedPaths}
                  editingRelPath={editing?.relPath ?? null}
                  selectedRelPath={selectedRelPath}
                  pasteTargetDirRelPath={
                    pasteReady && pasteDirRelPath !== '' ? pasteDirRelPath : null
                  }
                  dropTargetDirRelPath={dropTargetDirRelPath}
                  onToggleFolder={toggleFolder}
                  onSelect={(node) => setSelectedRelPath(node.relPath)}
                  onContextMenu={handleContextMenu}
                  onCancelRename={() => setEditing(null)}
                  onRename={rename}
                  onDropTargetChange={setDropTargetDirRelPath}
                  onMove={(payload, toDirRelPath) => {
                    void moveMaterial(payload, toDirRelPath)
                  }}
                  onImportFiles={(files, dirRelPath) => {
                    importFiles(files, dirRelPath)
                  }}
                />
              )}
            </section>
            <CourseGroupsSection courseId={course.id} />
          </>
        )}
      </div>

      {contextMenu !== null && (
        <MaterialsContextMenu
          {...contextMenu}
          onClose={closeContextMenu}
          onCreateFile={() => void createFile(contextMenu.target)}
          onCreateFolder={() => void createFolder(contextMenu.target)}
          onDuplicate={() => {
            if (contextMenu.target !== null) void duplicate(contextMenu.target)
          }}
          onCopyAbsolutePath={() => {
            if (course === null) return
            void writeClipboard(
              absoluteMaterialPath(
                course.folderPath,
                contextMenu.target?.relPath ?? ''
              )
            )
          }}
          onCopyRelativePath={() => {
            void writeClipboard(contextMenu.target?.relPath ?? '.')
          }}
          onReveal={() => {
            if (contextMenu.target !== null) void reveal(contextMenu.target)
          }}
          onRename={() => {
            if (contextMenu.target !== null) beginRename(contextMenu.target)
          }}
          onDelete={() => {
            if (contextMenu.target === null) return
            setDeleteError(null)
            setDeleteTarget(contextMenu.target)
            setContextMenu(null)
          }}
        />
      )}

      <MaterialDeleteDialog
        target={deleteTarget}
        pending={deletePending}
        error={deleteError}
        onClose={closeDeleteDialog}
        onConfirm={confirmDelete}
      />
    </aside>
  )
}
