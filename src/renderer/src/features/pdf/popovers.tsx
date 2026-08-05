/**
 * Floating popovers for the PDF viewer, positioned in scroller-content
 * coordinates (so they travel with the page while scrolling):
 *
 * - SelectionPopover: the 4-color mini toolbar shown over fresh text
 *   selections.
 * - HighlightPopover: comment / recolor / delete editor for an existing
 *   highlight.
 */

import { useEffect, useRef, useState } from 'react'
import { HIGHLIGHT_COLORS } from './useAnnotations'
import { Icon } from '../../app/icons'
import type {
  Annotation,
  HighlightColor
} from '../../../../shared/types/annotation'

const COLOR_LABEL: Record<HighlightColor, string> = {
  yellow: '노랑 형광펜',
  green: '초록 형광펜',
  pink: '분홍 형광펜',
  blue: '파랑 형광펜'
}

export interface ContentPoint {
  left: number
  top: number
}

/** Closes on Escape and on pointer-down outside the popover. */
function useDismiss(onDismiss: () => void): React.RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (
        ref.current !== null &&
        target instanceof Node &&
        !ref.current.contains(target)
      ) {
        onDismiss()
      }
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onDismiss])
  return ref
}

// -- selection toolbar ------------------------------------------------------

interface SelectionPopoverProps {
  position: ContentPoint
  onPick: (color: HighlightColor) => void
  onDismiss: () => void
}

export function SelectionPopover({
  position,
  onPick,
  onDismiss
}: SelectionPopoverProps): JSX.Element {
  const ref = useDismiss(onDismiss)
  return (
    <div
      ref={ref}
      className="pdf-popover pdf-popover--selection"
      role="toolbar"
      aria-label="형광펜 색상 선택"
      style={{ left: position.left, top: position.top }}
    >
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className="pdf-popover__swatch"
          data-color={color}
          aria-label={COLOR_LABEL[color]}
          title={COLOR_LABEL[color]}
          // Keep the text selection alive while clicking.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(color)}
        />
      ))}
    </div>
  )
}

// -- highlight editor -------------------------------------------------------

interface HighlightPopoverProps {
  annotation: Annotation
  position: ContentPoint
  isStale: boolean
  onChangeColor: (color: HighlightColor) => void
  onSaveComment: (comment: string | null) => void
  onDelete: () => void
  onDismiss: () => void
}

export function HighlightPopover({
  annotation,
  position,
  isStale,
  onChangeColor,
  onSaveComment,
  onDelete,
  onDismiss
}: HighlightPopoverProps): JSX.Element {
  const [draft, setDraft] = useState(annotation.comment ?? '')
  const ref = useDismiss(onDismiss)
  const savedComment = annotation.comment ?? ''
  const isDirty = draft !== savedComment

  const commit = (): void => {
    if (!isDirty) return
    const trimmed = draft.trim()
    onSaveComment(trimmed.length === 0 ? null : trimmed)
  }

  return (
    <div
      ref={ref}
      className="pdf-popover pdf-popover--edit"
      role="dialog"
      aria-label="하이라이트 편집"
      style={{ left: position.left, top: position.top }}
    >
      <header className="pdf-popover__head">
        <div className="pdf-popover__swatches">
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className="pdf-popover__swatch"
              data-color={color}
              data-selected={color === annotation.color}
              aria-label={COLOR_LABEL[color]}
              aria-pressed={color === annotation.color}
              onClick={() => onChangeColor(color)}
            />
          ))}
        </div>
        <button
          type="button"
          className="pdf-popover__icon-button pdf-popover__delete"
          aria-label="하이라이트 삭제"
          title="삭제"
          onClick={onDelete}
        >
          <Icon name="trash" />
        </button>
      </header>

      <blockquote className="pdf-popover__quote">
        {annotation.anchor.quote}
      </blockquote>
      {isStale && (
        <p
          className="pdf-popover__stale"
          title="문서가 바뀌어 이 인용을 원래 위치에서 찾지 못했어요."
        >
          위치가 정확하지 않을 수 있어요
        </p>
      )}

      <textarea
        className="pdf-popover__comment"
        placeholder="메모 남기기…"
        rows={3}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            commit()
            onDismiss()
          }
        }}
      />
      <footer className="pdf-popover__foot">
        <span className="pdf-popover__hint">⌘↩ 저장 후 닫기</span>
        <button
          type="button"
          className="pdf-popover__save"
          disabled={!isDirty}
          onClick={() => {
            commit()
            onDismiss()
          }}
        >
          저장
        </button>
      </footer>
    </div>
  )
}
