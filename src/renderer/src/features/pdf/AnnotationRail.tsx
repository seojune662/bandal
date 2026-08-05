/**
 * Right-hand annotation rail: page-grouped list of highlights with quote +
 * comment previews. Clicking an entry scrolls the viewer to the highlight
 * and flashes it. Stale entries (anchor no longer found in the page text)
 * get a subtle badge with an explanatory tooltip.
 */

import { useMemo } from 'react'
import { Icon } from '../../app/icons'
import type { Annotation } from '../../../../shared/types/annotation'

export interface AnnotationRailProps {
  annotations: Annotation[]
  staleIds: Set<string>
  activeId: string | null
  error: string | null
  onJump: (annotation: Annotation) => void
  onClose: () => void
}

interface PageGroup {
  page: number
  items: Annotation[]
}

function groupByPage(annotations: Annotation[]): PageGroup[] {
  const map = new Map<number, Annotation[]>()
  for (const annotation of annotations) {
    const list = map.get(annotation.page)
    if (list === undefined) {
      map.set(annotation.page, [annotation])
    } else {
      list.push(annotation)
    }
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([page, items]) => ({
      page,
      items: [...items].sort(
        (a, b) => (a.rects[0]?.y ?? 0) - (b.rects[0]?.y ?? 0)
      )
    }))
}

function RailItem({
  annotation,
  isStale,
  isActive,
  onJump
}: {
  annotation: Annotation
  isStale: boolean
  isActive: boolean
  onJump: (annotation: Annotation) => void
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        className="pdf-rail__item"
        data-active={isActive}
        onClick={() => onJump(annotation)}
      >
        <span
          className="pdf-rail__chip"
          data-color={annotation.color}
          aria-hidden="true"
        />
        <span className="pdf-rail__body">
          <span className="pdf-rail__quote">{annotation.anchor.quote}</span>
          {annotation.comment !== null && annotation.comment.length > 0 && (
            <span className="pdf-rail__comment">{annotation.comment}</span>
          )}
          {isStale && (
            <span
              className="pdf-rail__stale"
              title="문서가 바뀌어 이 인용을 원래 위치에서 찾지 못했어요. 표시 위치가 실제와 다를 수 있어요."
            >
              위치 불확실
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

export function AnnotationRail({
  annotations,
  staleIds,
  activeId,
  error,
  onJump,
  onClose
}: AnnotationRailProps): JSX.Element {
  const groups = useMemo(() => groupByPage(annotations), [annotations])

  return (
    <aside className="pdf-rail" aria-label="하이라이트 목록">
      <header className="pdf-rail__head">
        <h2 className="pdf-rail__title">
          하이라이트
          <span className="pdf-rail__count">{annotations.length}</span>
        </h2>
        <button
          type="button"
          className="pdf-rail__close"
          aria-label="하이라이트 목록 닫기"
          onClick={onClose}
        >
          <Icon name="x" />
        </button>
      </header>

      {error !== null && <p className="pdf-rail__error">{error}</p>}

      {groups.length === 0 ? (
        <div className="pdf-rail__empty">
          <span className="pdf-rail__empty-mark" aria-hidden="true">
            <Icon name="pencil" />
          </span>
          <p>
            본문을 드래그해 형광펜을
            <br />
            그어보세요.
          </p>
        </div>
      ) : (
        <div className="pdf-rail__scroll">
          {groups.map((group) => (
            <section key={group.page} className="pdf-rail__group">
              <h3 className="pdf-rail__page">p. {group.page}</h3>
              <ul className="pdf-rail__list">
                {group.items.map((annotation) => (
                  <RailItem
                    key={annotation.id}
                    annotation={annotation}
                    isStale={staleIds.has(annotation.id)}
                    isActive={annotation.id === activeId}
                    onJump={onJump}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </aside>
  )
}
