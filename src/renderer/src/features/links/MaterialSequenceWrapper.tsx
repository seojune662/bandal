/**
 * 모든 워크스페이스 탭을 감싸는 순서 연결 레이어.
 *
 * 두 가지를 얹는다:
 * 1. 자료 파일 드래그(materialFileDrag) 중에만 나타나는 좌/우 가장자리
 *    드롭존 — 오른쪽에 놓으면 "이 탭의 다음", 왼쪽이면 "이전"으로 연결.
 * 2. 연결이 있으면 탭 상단의 ← 이전 · 다음 → 내비게이션 바.
 *
 * 드롭존은 document.body 포탈 + position:fixed 다: 브라우저 탭의 webview
 * 게스트가 window 레벨 고정 레이어(z-index 10)에 살아서 패널 DOM 내부
 * 요소로는 위를 덮을 수 없다. pointer passthrough 는 일부러 잡지 않는다 —
 * 그걸 잡으면 웹뷰 안 업로드 폼(메일 첨부, LMS 제출)으로의 파일 드롭이
 * 죽는다. 가장자리 스트립만 z-상위에서 가로채고 중앙은 게스트가 받는다.
 */

import {
  useEffect,
  useState,
  useRef,
  useSyncExternalStore,
  type FunctionComponent
} from 'react'
import { createPortal } from 'react-dom'
import type { IDockviewPanelProps } from 'dockview'
import { isTabDescriptor, type TabDescriptor } from '../../../../shared/tabs'
import { Icon } from '../../app/icons'
import { showToast } from '../../app/toast'
import { invoke, onPush, pathForFile } from '../../lib/ipc'
import { useCoursesStore } from '../../stores/coursesStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { tabTitle } from '../workspace/tabIdentity'
import { relPathInsideCourse } from '../materials/importDrop'
import {
  clearMaterialFileDrag,
  getMaterialFileDrag,
  subscribeMaterialFileDrag,
  type MaterialFileDragState
} from '../materials/materialFileDrag'
import { materialLinkDescriptor } from './LinkPickerDialog'
import {
  SEQUENCE_LABEL,
  edgeDropPlan,
  pickSequence,
  type SequenceEdge,
  type SequenceNeighbors
} from './sequenceLinks'
import { requestMaterialConnectionsRefresh } from './useMaterialConnections'
import './links.css'

const EMPTY_NEIGHBORS: SequenceNeighbors = { prev: null, next: null }
const EDGE_STRIP_WIDTH_PX = 36

function descriptorCourseId(descriptor: TabDescriptor): string | null {
  const payload = descriptor.payload as Record<string, unknown>
  const courseId = payload['courseId']
  return typeof courseId === 'string' && courseId.length > 0 ? courseId : null
}

function useSequenceNeighbors(
  courseId: string | null,
  descriptorJson: string | null
): SequenceNeighbors {
  const [neighbors, setNeighbors] = useState<SequenceNeighbors>(EMPTY_NEIGHBORS)

  useEffect(() => {
    if (courseId === null || descriptorJson === null) {
      setNeighbors(EMPTY_NEIGHBORS)
      return
    }
    const descriptor = JSON.parse(descriptorJson) as TabDescriptor
    let disposed = false
    let sequence = 0

    const load = async (): Promise<void> => {
      const current = ++sequence
      try {
        const result = await invoke('links:listForDescriptor', {
          courseId,
          descriptor
        })
        if (!disposed && current === sequence) {
          setNeighbors(pickSequence(result.outgoing, result.incoming))
        }
      } catch (caught) {
        if (!disposed && current === sequence) {
          console.error('[Bandal] 순서 연결을 불러오지 못했습니다.', caught)
          setNeighbors(EMPTY_NEIGHBORS)
        }
      }
    }

    void load()
    // links:create/remove 가 materials:changed 를 broadcast 하므로 이거면 된다.
    const stop = onPush('materials:changed', (payload) => {
      if (payload.courseId === courseId) void load()
    })
    return () => {
      disposed = true
      sequence += 1
      stop()
    }
  }, [courseId, descriptorJson])

  return neighbors
}

/**
 * 드롭된 Files 가 기록된 드래그와 같은 파일인지 대조한다. 파일이 비어 있으면
 * (e2e 합성 이벤트) 모듈 상태를 신뢰하고, 경로가 어긋나면 스테일 상태다.
 */
function dropMatchesDrag(
  event: React.DragEvent,
  drag: MaterialFileDragState,
  courseFolder: string | undefined
): boolean {
  const files = event.dataTransfer?.files
  if (files === undefined || files.length === 0) return true
  if (courseFolder === undefined) return false
  const first = files[0]
  if (first === undefined) return false
  const absPath = pathForFile(first)
  return relPathInsideCourse(absPath, courseFolder) === drag.relPath
}

function EdgeDropStrips({
  hostRef,
  tabDescriptor,
  tabCourseId
}: {
  hostRef: React.RefObject<HTMLDivElement>
  tabDescriptor: TabDescriptor
  tabCourseId: string | null
}): JSX.Element | null {
  const drag = useSyncExternalStore(
    subscribeMaterialFileDrag,
    getMaterialFileDrag
  )
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [hoverEdge, setHoverEdge] = useState<SequenceEdge | null>(null)
  const courses = useCoursesStore((state) => state.courses)

  useEffect(() => {
    if (drag === null) {
      setRect(null)
      setHoverEdge(null)
      return
    }
    const host = hostRef.current
    if (host === null) return
    const next = host.getBoundingClientRect()
    // 숨겨진(비활성) 패널은 폭이 0 — 스트립을 만들지 않는다.
    setRect(next.width > 0 && next.height > 0 ? next : null)
  }, [drag, hostRef])

  if (drag === null || rect === null) return null
  // 링크는 자료의 과목 아래 저장된다. 과목이 있는 탭이면 같은 과목만 허용.
  if (tabCourseId !== null && tabCourseId !== drag.courseId) return null

  const material = materialLinkDescriptor(drag.courseId, drag.relPath)

  const handleDrop = (edge: SequenceEdge) => (event: React.DragEvent) => {
    event.preventDefault()
    setHoverEdge(null)
    const courseFolder = courses.find(
      (course) => course.id === drag.courseId
    )?.folderPath
    if (!dropMatchesDrag(event, drag, courseFolder)) {
      clearMaterialFileDrag()
      return
    }
    clearMaterialFileDrag()

    const plan = edgeDropPlan(edge, tabDescriptor, material)
    void invoke('links:create', {
      courseId: drag.courseId,
      source: plan.source,
      target: plan.target,
      label: SEQUENCE_LABEL
    })
      .then(() => {
        requestMaterialConnectionsRefresh(drag.courseId)
        showToast(
          edge === 'next' ? '다음 자료로 연결했어요' : '이전 자료로 연결했어요'
        )
      })
      .catch((caught: unknown) => {
        console.error('[Bandal] 자료를 연결하지 못했습니다.', caught)
        showToast(
          caught instanceof Error && caught.message.includes('different')
            ? '같은 자료끼리는 연결할 수 없어요'
            : '자료를 연결하지 못했어요',
          'danger'
        )
      })
  }

  const stripProps = (edge: SequenceEdge): React.HTMLAttributes<HTMLDivElement> => ({
    onDragOver: (event) => {
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'link'
    },
    onDragEnter: () => setHoverEdge(edge),
    onDragLeave: () => {
      setHoverEdge((current) => (current === edge ? null : current))
    },
    onDrop: handleDrop(edge)
  })

  return createPortal(
    <>
      <div
        className="sequence-drop-strip sequence-drop-strip--prev"
        data-active={hoverEdge === 'prev' || undefined}
        style={{
          top: rect.top,
          left: rect.left,
          height: rect.height,
          width: EDGE_STRIP_WIDTH_PX
        }}
        {...stripProps('prev')}
      >
        <span className="sequence-drop-strip__hint">이전</span>
      </div>
      <div
        className="sequence-drop-strip sequence-drop-strip--next"
        data-active={hoverEdge === 'next' || undefined}
        style={{
          top: rect.top,
          left: rect.right - EDGE_STRIP_WIDTH_PX,
          height: rect.height,
          width: EDGE_STRIP_WIDTH_PX
        }}
        {...stripProps('next')}
      >
        <span className="sequence-drop-strip__hint">다음</span>
      </div>
    </>,
    document.body
  )
}

function SequenceNavBar({
  neighbors
}: {
  neighbors: SequenceNeighbors
}): JSX.Element | null {
  const openTab = useWorkspaceStore((state) => state.openTab)
  if (neighbors.prev === null && neighbors.next === null) return null

  return (
    <nav className="sequence-nav" aria-label="연결된 자료 이동">
      {neighbors.prev !== null && (
        <button
          type="button"
          className="sequence-nav__link sequence-nav__link--prev"
          title={tabTitle(neighbors.prev.source)}
          onClick={() => {
            if (neighbors.prev !== null) openTab(neighbors.prev.source)
          }}
        >
          <Icon name="chevronLeft" />
          <span>{tabTitle(neighbors.prev.source)}</span>
        </button>
      )}
      <span className="sequence-nav__spacer" aria-hidden="true" />
      {neighbors.next !== null && (
        <button
          type="button"
          className="sequence-nav__link sequence-nav__link--next"
          title={tabTitle(neighbors.next.target)}
          onClick={() => {
            if (neighbors.next !== null) openTab(neighbors.next.target)
          }}
        >
          <span>{tabTitle(neighbors.next.target)}</span>
          <Icon name="chevronRight" />
        </button>
      )}
    </nav>
  )
}

/** dockviewComponents 생성 시 모든 TabKind 를 이걸로 감싼다. */
export function withMaterialSequence(
  Component: FunctionComponent<IDockviewPanelProps>
): FunctionComponent<IDockviewPanelProps> {
  function MaterialSequenceHost(props: IDockviewPanelProps): JSX.Element {
    const hostRef = useRef<HTMLDivElement>(null)
    const rawDescriptor = (props.params as Record<string, unknown>)['descriptor']
    const descriptor = isTabDescriptor(rawDescriptor) ? rawDescriptor : null
    const selectedCourseId = useCoursesStore((state) => state.selectedCourseId)
    const tabCourseId = descriptor === null ? null : descriptorCourseId(descriptor)
    const queryCourseId = tabCourseId ?? selectedCourseId
    // params 객체는 참조가 흔들릴 수 있어 JSON 문자열로 정체성을 고정한다.
    const descriptorJson =
      descriptor === null ? null : JSON.stringify(descriptor)
    const neighbors = useSequenceNeighbors(queryCourseId, descriptorJson)

    if (descriptor === null) return <Component {...props} />

    return (
      <div ref={hostRef} className="material-sequence-host">
        <SequenceNavBar neighbors={neighbors} />
        <div className="material-sequence-host__content">
          <Component {...props} />
        </div>
        <EdgeDropStrips
          hostRef={hostRef}
          tabDescriptor={descriptor}
          tabCourseId={tabCourseId}
        />
      </div>
    )
  }
  MaterialSequenceHost.displayName = `withMaterialSequence(${
    Component.displayName ?? Component.name ?? 'Panel'
  })`
  return MaterialSequenceHost
}
