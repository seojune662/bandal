import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type {
  PptxPresentation,
  PptxScrollViewer
} from '@silurus/ooxml/pptx'
import {
  EMU_PER_INCH,
  parsePptx,
  type ParsedPresentation,
  type SlideFrame,
  type SlideParagraph,
  type SlideShape
} from '../pptx/parsePptx'

interface SlidesViewerProps {
  base64: string
  fileName: string
  onError: () => void
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function loadPresentation(base64: string): Promise<ParsedPresentation> {
  const jszipModule = await import('jszip')
  const JSZip = (jszipModule as unknown as { default?: typeof import('jszip') })
    .default ?? jszipModule
  const zip = await JSZip.loadAsync(base64ToBytes(base64))
  const files = new Map<string, string | Uint8Array>()
  const loads: Promise<void>[] = []
  zip.forEach((path, entry) => {
    if (entry.dir) return
    if (path.endsWith('.xml') || path.endsWith('.rels')) {
      loads.push(entry.async('string').then((text) => void files.set(path, text)))
    } else if (path.startsWith('ppt/media/')) {
      loads.push(
        entry.async('uint8array').then((bytes) => void files.set(path, bytes))
      )
    }
  })
  await Promise.all(loads)
  return parsePptx(files)
}

function frameStyle(frame: SlideFrame, cx: number, cy: number): CSSProperties {
  return {
    left: `${(frame.x / cx) * 100}%`,
    top: `${(frame.y / cy) * 100}%`,
    width: `${(frame.w / cx) * 100}%`,
    height: `${(frame.h / cy) * 100}%`
  }
}

const DEFAULT_TEXT_PT = 18

function Paragraphs({
  paragraphs,
  scale
}: {
  paragraphs: SlideParagraph[]
  scale: number
}): JSX.Element {
  return (
    <>
      {paragraphs.map((runs, paragraphIndex) => (
        <p key={paragraphIndex} className="file-slides__paragraph">
          {runs.map((run, runIndex) => (
            <span
              key={runIndex}
              style={{
                fontSize: `${(run.sizePt ?? DEFAULT_TEXT_PT) * (96 / 72) * scale}px`,
                ...(run.bold === true ? { fontWeight: 700 } : {}),
                ...(run.color !== undefined ? { color: run.color } : {})
              }}
            >
              {run.text}
            </span>
          ))}
        </p>
      ))}
    </>
  )
}

function ShapeView({
  shape,
  cx,
  cy,
  scale
}: {
  shape: SlideShape
  cx: number
  cy: number
  scale: number
}): JSX.Element | null {
  const positioned = shape.frame !== null
  const style = shape.frame !== null ? frameStyle(shape.frame, cx, cy) : undefined
  const className = positioned
    ? 'file-slides__shape'
    : 'file-slides__shape file-slides__shape--flow'

  if (shape.type === 'text') {
    if (shape.paragraphs.every((runs) => runs.every((run) => run.text.trim() === ''))) {
      return null
    }
    return (
      <div className={className} style={style}>
        <Paragraphs paragraphs={shape.paragraphs} scale={scale} />
      </div>
    )
  }
  if (shape.type === 'image') {
    if (shape.dataUrl === null) {
      return (
        <div className={`${className} file-slides__shape--placeholder`} style={style}>
          {shape.label}
        </div>
      )
    }
    return (
      <div className={className} style={style}>
        <img src={shape.dataUrl} alt={shape.label} draggable={false} />
      </div>
    )
  }
  if (shape.type === 'table') {
    return (
      <div className={className} style={style}>
        <table className="file-slides__table">
          <tbody>
            {shape.rows.map((cells, rowIndex) => (
              <tr key={rowIndex}>
                {cells.map((cell, cellIndex) => (
                  <td key={cellIndex}>
                    <Paragraphs paragraphs={[cell]} scale={scale} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return (
    <div className={`${className} file-slides__shape--placeholder`} style={style}>
      {shape.label}
    </div>
  )
}

/**
 * PPTX 슬라이드 미리보기 — 텍스트·이미지·표를 원 배치대로, 차트류는
 * 자리표시로 렌더한다(테마 색·마스터 상속은 생략, 읽기 전용).
 */
function LegacySlidesViewer({
  base64,
  fileName,
  onError
}: SlidesViewerProps): JSX.Element {
  const [presentation, setPresentation] = useState<ParsedPresentation | null>(null)
  const [slideWidthPx, setSlideWidthPx] = useState(0)
  const columnRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    loadPresentation(base64)
      .then((parsed) => {
        if (!cancelled) setPresentation(parsed)
      })
      .catch((error: unknown) => {
        console.error('[Bandal] PPTX 해석 실패', error)
        if (!cancelled) onError()
      })
    return () => {
      cancelled = true
    }
  }, [base64, onError])

  useEffect(() => {
    const column = columnRef.current
    if (column === null) return
    const observer = new ResizeObserver(() => {
      const slide = column.querySelector('.file-slides__slide')
      if (slide instanceof HTMLElement) {
        setSlideWidthPx(slide.getBoundingClientRect().width)
      }
    })
    observer.observe(column)
    return () => observer.disconnect()
  }, [presentation])

  if (presentation === null) {
    return (
      <div className="file-status" role="status">
        슬라이드를 해석하는 중…
      </div>
    )
  }

  const { slideCx, slideCy, slides } = presentation
  const slideInchWidth = slideCx / EMU_PER_INCH
  const scale = slideWidthPx > 0 ? slideWidthPx / (slideInchWidth * 96) : 1

  return (
    <div className="file-slides">
      <header className="file-slides__header">
        <strong>{fileName}</strong>
        <span>{slides.length}슬라이드 · 읽기 전용 미리보기</span>
      </header>
      <div className="file-slides__column" ref={columnRef}>
        {slides.map((slide, index) => {
          const flowShapes = slide.shapes.filter((shape) => shape.frame === null)
          return (
            <section
              key={index}
              className="file-slides__page"
              aria-label={`슬라이드 ${index + 1}`}
            >
              <div
                className="file-slides__slide"
                style={{ aspectRatio: `${slideCx} / ${slideCy}` }}
              >
                {slide.shapes.map((shape, shapeIndex) =>
                  shape.frame === null ? null : (
                    <ShapeView
                      key={shapeIndex}
                      shape={shape}
                      cx={slideCx}
                      cy={slideCy}
                      scale={scale}
                    />
                  )
                )}
                <span className="file-slides__badge">{index + 1}</span>
              </div>
              {flowShapes.length > 0 && (
                <div className="file-slides__overflow">
                  {flowShapes.map((shape, shapeIndex) => (
                    <ShapeView
                      key={shapeIndex}
                      shape={shape}
                      cx={slideCx}
                      cy={slideCy}
                      scale={scale}
                    />
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

const PPTX_RESOURCE_LIMITS = {
  maxArchiveEntries: 4_096,
  maxArchiveEntryBytes: 128 * 1024 * 1024,
  maxTotalInflatedBytes: 256 * 1024 * 1024
} as const

function pptxErrorMessage(error: unknown): string {
  if (error instanceof Error && /password|encrypt/iu.test(error.message)) {
    return '암호화된 PPTX는 외부 앱에서 열어 주세요.'
  }
  if (error instanceof Error && /resource|limit|archive|inflated/iu.test(error.message)) {
    return '안전 제한을 넘는 큰 PPTX예요. 간이 미리보기로 열었어요.'
  }
  return '일부 슬라이드를 정밀하게 해석하지 못해 간이 미리보기로 열었어요.'
}

function HighFidelitySlidesViewer({
  base64,
  fileName,
  onFallback
}: {
  base64: string
  fileName: string
  onFallback: (message: string) => void
}): JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null)
  const presentationRef = useRef<PptxPresentation | null>(null)
  const viewerRef = useRef<PptxScrollViewer | null>(null)
  const [slideCount, setSlideCount] = useState(0)
  const [visibleSlide, setVisibleSlide] = useState(0)
  const [scale, setScale] = useState(1)
  const [notesOpen, setNotesOpen] = useState(false)

  useEffect(() => {
    const mount = mountRef.current
    if (mount === null) return
    let cancelled = false

    void import('@silurus/ooxml/pptx')
      .then(async ({ PptxPresentation, PptxScrollViewer }) => {
        const bytes = base64ToBytes(base64)
        const source = bytes.slice().buffer as ArrayBuffer
        const presentation = await PptxPresentation.load(source, {
          mode: 'worker',
          progressiveLayout: true,
          useGoogleFonts: false,
          resourceLimits: PPTX_RESOURCE_LIMITS
        })
        if (cancelled) {
          presentation.destroy()
          return
        }
        presentationRef.current = presentation
        const viewer = PptxScrollViewer.fromPresentation(mount, presentation, {
          background: 'transparent',
          pageShadow: '0 12px 34px rgb(27 25 20 / 14%)',
          gap: 28,
          paddingTop: 24,
          paddingBottom: 48,
          paddingLeft: 24,
          paddingRight: 24,
          overscan: 1,
          refitOnResize: true,
          enableZoom: true,
          enableTextSelection: true,
          enableHyperlinks: true,
          onVisibleSlideChange: (index, total) => {
            setVisibleSlide(index)
            setSlideCount(total)
          },
          onScaleChange: setScale,
          onError: (error) => console.warn('[Bandal] PPTX 슬라이드 렌더링 경고', error)
        })
        viewerRef.current = viewer as PptxScrollViewer
        if (cancelled) return
        setSlideCount(presentation.slideCount)
        viewer.fitWidth()
      })
      .catch((error: unknown) => {
        console.error('[Bandal] 고정밀 PPTX 해석 실패', error)
        if (!cancelled) onFallback(pptxErrorMessage(error))
      })

    return () => {
      cancelled = true
      viewerRef.current?.destroy()
      viewerRef.current = null
      presentationRef.current?.destroy()
      presentationRef.current = null
      mount.replaceChildren()
    }
  }, [base64, onFallback])

  const notes = presentationRef.current?.getNotes(visibleSlide)?.trim() ?? ''

  return (
    <div className="file-slides file-slides--precise">
      <header className="file-slides__header file-slides__header--toolbar">
        <span className="file-slides__heading">
          <strong>{fileName}</strong>
          <span>
            {slideCount > 0
              ? `${visibleSlide + 1} / ${slideCount}슬라이드`
              : '슬라이드를 해석하는 중…'}
          </span>
        </span>
        <span className="file-slides__actions" aria-label="슬라이드 보기 설정">
          <button
            type="button"
            aria-label="축소"
            title="축소"
            onClick={() => viewerRef.current?.zoomOut()}
          >
            −
          </button>
          <button
            type="button"
            className="file-slides__scale"
            title="너비에 맞추기"
            onClick={() => viewerRef.current?.fitWidth()}
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            aria-label="확대"
            title="확대"
            onClick={() => viewerRef.current?.zoomIn()}
          >
            +
          </button>
          <button
            type="button"
            aria-pressed={notesOpen}
            disabled={notes === ''}
            onClick={() => setNotesOpen((open) => !open)}
          >
            노트
          </button>
        </span>
      </header>
      <div className="file-slides__precise-body">
        <div ref={mountRef} className="file-slides__precise-viewer" />
        {notesOpen && notes !== '' && (
          <aside className="file-slides__notes" aria-label="발표자 노트">
            <strong>{visibleSlide + 1}번 슬라이드 노트</strong>
            <p>{notes}</p>
          </aside>
        )}
      </div>
    </div>
  )
}

/**
 * Offline high-fidelity renderer first; the deliberately small OOXML parser
 * remains as a readable, crash-safe fallback for encrypted or malformed decks.
 */
export function SlidesViewer(props: SlidesViewerProps): JSX.Element {
  const [fallbackMessage, setFallbackMessage] = useState<string | null>(null)
  const onFallback = useRef((message: string) => setFallbackMessage(message)).current

  if (fallbackMessage !== null) {
    return (
      <div className="file-slides__fallback">
        <p role="status">{fallbackMessage}</p>
        <LegacySlidesViewer {...props} />
      </div>
    )
  }
  return <HighFidelitySlidesViewer {...props} onFallback={onFallback} />
}
