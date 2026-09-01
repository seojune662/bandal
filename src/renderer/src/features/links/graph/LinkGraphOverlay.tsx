/**
 * 과목 연결 그래프 오버레이 — 옵시디언 그래프 뷰의 반달판.
 *
 * BoardOverlay 골격(백드롭 + 다이얼로그 + 포커스 트랩 + 포인터 패스스루)을
 * 그대로 따른다. 데이터는 열 때 1회 + 수동 새로고침만 — links:graph 의
 * 백링크 절반이 과목 전체 재스캔이라 materials:changed 자동 재조회는
 * 일부러 하지 않는다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WheelEvent as ReactWheelEvent } from 'react'
import { Icon } from '../../../app/icons'
import { useT } from '../../../i18n'
import { invoke } from '../../../lib/ipc'
import { useWorkspaceStore } from '../../../stores/workspaceStore'
import { useFocusTrap } from '../../../components/useFocusTrap'
import { acquirePointerPassthrough } from '../../browser/webviewPassthrough'
import {
  flattenMaterialFiles,
  materialLinkDescriptor
} from '../LinkPickerDialog'
import {
  buildLinkGraph,
  nodeDegrees,
  type GraphNode,
  type LinkGraph
} from './linkGraphModel'
import { layoutGraph } from './linkGraphLayout'
import './linkGraph.css'

const CANVAS_WIDTH = 1200
const CANVAS_HEIGHT = 800
const MIN_ZOOM = 0.4
const MAX_ZOOM = 4

interface LinkGraphOverlayProps {
  courseId: string
  onClose: () => void
}

interface ViewBox {
  x: number
  y: number
  scale: number
}

type LoadPhase = 'loading' | 'ready' | 'error'

export function LinkGraphOverlay({
  courseId,
  onClose
}: LinkGraphOverlayProps): JSX.Element {
  const t = useT()
  const dialogRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [phase, setPhase] = useState<LoadPhase>('loading')
  const [graph, setGraph] = useState<LinkGraph | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [view, setView] = useState<ViewBox>({ x: 0, y: 0, scale: 1 })
  const panRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)

  useFocusTrap(dialogRef, { active: true, onEscape: onClose })
  // 오버레이가 브라우저 레이어 위에 뜨는 동안 webview 가 포인터를 먹지 않게.
  useEffect(() => acquirePointerPassthrough(), [])

  const load = useCallback(async (): Promise<void> => {
    setPhase('loading')
    try {
      const [tree, data] = await Promise.all([
        invoke('materials:tree', { courseId }),
        invoke('links:graph', { courseId })
      ])
      setGraph(
        buildLinkGraph(flattenMaterialFiles(tree), data.links, data.backlinks)
      )
      setPhase('ready')
    } catch (caught) {
      console.error('[Bandal] 연결 그래프를 불러오지 못했습니다.', caught)
      setPhase('error')
    }
  }, [courseId])

  useEffect(() => {
    void load()
  }, [load])

  const positions = useMemo(
    () =>
      graph === null
        ? null
        : layoutGraph(graph.nodes, graph.edges, {
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT
          }),
    [graph]
  )
  const degrees = useMemo(
    () => (graph === null ? null : nodeDegrees(graph)),
    [graph]
  )

  const openNode = useCallback(
    (node: GraphNode): void => {
      const descriptor =
        node.relPath !== null && node.kind !== 'missing'
          ? materialLinkDescriptor(courseId, node.relPath)
          : node.descriptor
      if (descriptor === null) return
      useWorkspaceStore.getState().openTab(descriptor)
      onClose()
    },
    [courseId, onClose]
  )

  const handleWheel = useCallback((event: ReactWheelEvent<SVGSVGElement>): void => {
    event.preventDefault()
    const svg = svgRef.current
    if (svg === null) return
    setView((current) => {
      const factor = Math.exp(-event.deltaY * 0.002)
      const nextScale = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, current.scale * factor)
      )
      if (nextScale === current.scale) return current
      // 커서 아래 지점이 고정되도록 뷰 원점을 보정한다.
      const bounds = svg.getBoundingClientRect()
      const pointerX =
        current.x + ((event.clientX - bounds.left) / bounds.width) *
          (CANVAS_WIDTH / current.scale)
      const pointerY =
        current.y + ((event.clientY - bounds.top) / bounds.height) *
          (CANVAS_HEIGHT / current.scale)
      const ratio = current.scale / nextScale
      return {
        scale: nextScale,
        x: pointerX - (pointerX - current.x) * ratio,
        y: pointerY - (pointerY - current.y) * ratio
      }
    })
  }, [])

  const viewBox = `${view.x} ${view.y} ${CANVAS_WIDTH / view.scale} ${CANVAS_HEIGHT / view.scale}`
  const hoveredNeighbors =
    hoveredId === null ? null : graph?.neighbors.get(hoveredId) ?? null

  return (
    <div className="link-graph-overlay" role="presentation">
      <button
        type="button"
        className="link-graph-overlay__backdrop"
        aria-label={t('links.graph.close')}
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        className="link-graph-overlay__surface"
        role="dialog"
        aria-modal="true"
        aria-label={t('links.graph.title')}
      >
        <header className="link-graph-overlay__head">
          <div>
            <p className="eyebrow">GRAPH</p>
            <h2>{t('links.graph.title')}</h2>
          </div>
          <div className="link-graph-overlay__actions">
            <button
              type="button"
              className="bare-icon-button"
              aria-label={t('links.graph.refresh')}
              title={t('links.graph.refresh')}
              disabled={phase === 'loading'}
              onClick={() => void load()}
            >
              <Icon name="refresh" />
            </button>
            <button
              type="button"
              className="bare-icon-button"
              aria-label={t('links.graph.close')}
              onClick={onClose}
            >
              <Icon name="x" />
            </button>
          </div>
        </header>

        {phase === 'error' ? (
          <p className="link-graph-overlay__state" role="alert">
            {t('links.graph.loadFailed')}
          </p>
        ) : phase === 'loading' ? (
          <p className="link-graph-overlay__state" role="status">
            {t('links.graph.loading')}
          </p>
        ) : graph === null || graph.nodes.length === 0 ? (
          <p className="link-graph-overlay__state">{t('links.graph.empty')}</p>
        ) : (
          <svg
            ref={svgRef}
            className="link-graph"
            viewBox={viewBox}
            role="img"
            aria-label={t('links.graph.title')}
            onWheel={handleWheel}
            onPointerDown={(event) => {
              if (event.target !== event.currentTarget) return
              panRef.current = {
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY
              }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              const pan = panRef.current
              const svg = svgRef.current
              if (pan === null || svg === null || pan.pointerId !== event.pointerId) {
                return
              }
              const bounds = svg.getBoundingClientRect()
              const unitX = CANVAS_WIDTH / view.scale / bounds.width
              const unitY = CANVAS_HEIGHT / view.scale / bounds.height
              setView((current) => ({
                ...current,
                x: current.x - (event.clientX - pan.x) * unitX,
                y: current.y - (event.clientY - pan.y) * unitY
              }))
              panRef.current = {
                pointerId: pan.pointerId,
                x: event.clientX,
                y: event.clientY
              }
            }}
            onPointerUp={() => {
              panRef.current = null
            }}
            onPointerCancel={() => {
              panRef.current = null
            }}
          >
            <defs>
              <marker
                id="link-graph-arrow"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L8 4 L0 8 z" className="link-graph__arrow" />
              </marker>
            </defs>
            {positions !== null &&
              graph.edges.map((edge) => {
                const from = positions.get(edge.sourceId)
                const to = positions.get(edge.targetId)
                if (from === undefined || to === undefined) return null
                const dimmed =
                  hoveredNeighbors !== null &&
                  !(
                    hoveredNeighbors.has(edge.sourceId) &&
                    hoveredNeighbors.has(edge.targetId)
                  )
                return (
                  <line
                    key={edge.id}
                    className="link-graph__edge"
                    data-kind={edge.kind}
                    data-dimmed={dimmed || undefined}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    markerEnd={
                      edge.kind === 'sequence'
                        ? 'url(#link-graph-arrow)'
                        : undefined
                    }
                  />
                )
              })}
            {positions !== null &&
              degrees !== null &&
              graph.nodes.map((node) => {
                const point = positions.get(node.id)
                if (point === undefined) return null
                const dimmed =
                  hoveredNeighbors !== null && !hoveredNeighbors.has(node.id)
                const radius = Math.min(
                  12,
                  6 + (degrees.get(node.id) ?? 0) * 1.5
                )
                const openable =
                  node.descriptor !== null ||
                  (node.relPath !== null && node.kind !== 'missing')
                return (
                  <g
                    key={node.id}
                    className="link-graph__node"
                    data-kind={node.kind}
                    data-dimmed={dimmed || undefined}
                    data-openable={openable || undefined}
                    onMouseEnter={() => setHoveredId(node.id)}
                    onMouseLeave={() =>
                      setHoveredId((current) =>
                        current === node.id ? null : current
                      )}
                    onClick={() => openNode(node)}
                  >
                    {node.kind === 'board' ? (
                      <rect
                        x={point.x - radius}
                        y={point.y - radius}
                        width={radius * 2}
                        height={radius * 2}
                        rx={3}
                      />
                    ) : (
                      <circle cx={point.x} cy={point.y} r={radius} />
                    )}
                    <text x={point.x} y={point.y + radius + 14}>
                      {node.label}
                    </text>
                    <title>{node.label}</title>
                  </g>
                )
              })}
          </svg>
        )}

        <footer className="link-graph-overlay__legend" aria-hidden="true">
          <span className="link-graph-overlay__legend-item" data-kind="link">
            {t('links.graph.legend.link')}
          </span>
          <span className="link-graph-overlay__legend-item" data-kind="sequence">
            {t('links.graph.legend.sequence')}
          </span>
          <span className="link-graph-overlay__legend-item" data-kind="backlink">
            {t('links.graph.legend.backlink')}
          </span>
        </footer>
      </div>
    </div>
  )
}
