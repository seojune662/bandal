/**
 * Viewer chrome above the page scroller: page indicator with jump-to-page
 * input, zoom controls (fit-width is 100%), and the annotation-rail toggle.
 * Styled to read as Bandal shell chrome, not embedded pdf.js UI.
 */

import { useEffect, useState } from 'react'
import { Icon } from '../../app/icons'
import { PdfToolRail } from './tools/PdfToolRail'
import type { DrawingsApi } from './tools/useDrawings'

export interface PdfToolbarProps {
  currentPage: number
  numPages: number
  zoomPercent: number
  isPreviewOpen: boolean
  isRailOpen: boolean
  annotationCount: number
  courseId: string
  relPath: string
  drawingsApi: DrawingsApi
  onJumpToPage: (page: number) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomFit: () => void
  onTogglePreview: () => void
  onToggleRail: () => void
}

function PageJump({
  currentPage,
  numPages,
  onJumpToPage
}: Pick<PdfToolbarProps, 'currentPage' | 'numPages' | 'onJumpToPage'>): JSX.Element {
  const [draft, setDraft] = useState(String(currentPage))
  const [isEditing, setIsEditing] = useState(false)

  useEffect(() => {
    if (!isEditing) setDraft(String(currentPage))
  }, [currentPage, isEditing])

  const submit = (): void => {
    const parsed = Number.parseInt(draft, 10)
    if (Number.isInteger(parsed)) onJumpToPage(parsed)
    setIsEditing(false)
  }

  return (
    <form
      className="pdf-toolbar__pages"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <input
        className="pdf-toolbar__page-input"
        type="text"
        inputMode="numeric"
        aria-label="페이지 이동"
        value={draft}
        onFocus={(event) => {
          setIsEditing(true)
          event.target.select()
        }}
        onBlur={submit}
        onChange={(event) => setDraft(event.target.value)}
      />
      <span className="pdf-toolbar__page-total">/ {numPages}</span>
    </form>
  )
}

export function PdfToolbar(props: PdfToolbarProps): JSX.Element {
  const {
    zoomPercent,
    isPreviewOpen,
    isRailOpen,
    annotationCount,
    onZoomIn,
    onZoomOut,
    onZoomFit,
    onTogglePreview,
    onToggleRail
  } = props

  return (
    <div className="pdf-toolbar" role="toolbar" aria-label="PDF 뷰어 도구">
      <button
        type="button"
        className="pdf-toolbar__preview-toggle"
        aria-pressed={isPreviewOpen}
        onClick={onTogglePreview}
      >
        <Icon name="layoutLeft" />
        미리보기
      </button>

      <PageJump
        currentPage={props.currentPage}
        numPages={props.numPages}
        onJumpToPage={props.onJumpToPage}
      />

      <PdfToolRail
        courseId={props.courseId}
        relPath={props.relPath}
        drawingsApi={props.drawingsApi}
      />

      <div className="pdf-toolbar__zoom">
        <button
          type="button"
          className="pdf-toolbar__button"
          aria-label="축소"
          title="축소"
          onClick={onZoomOut}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="1em" height="1em">
            <path
              d="M5 12h14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="pdf-toolbar__zoom-value"
          title="폭 맞춤으로 되돌리기"
          aria-label={`현재 배율 ${zoomPercent}%, 클릭하면 폭 맞춤`}
          onClick={onZoomFit}
        >
          {zoomPercent}%
        </button>
        <button
          type="button"
          className="pdf-toolbar__button"
          aria-label="확대"
          title="확대"
          onClick={onZoomIn}
        >
          <Icon name="plus" />
        </button>
      </div>

      <button
        type="button"
        className="pdf-toolbar__rail-toggle"
        aria-pressed={isRailOpen}
        aria-label="하이라이트 목록 토글"
        title="하이라이트 목록"
        onClick={onToggleRail}
      >
        <Icon name="layoutRight" />
        {annotationCount > 0 && (
          <span className="pdf-toolbar__badge">{annotationCount}</span>
        )}
      </button>
    </div>
  )
}
