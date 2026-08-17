import { useEffect, useId, useMemo, useState } from 'react'
import type { MaterialFileContent } from '../../../../../shared/types/materials'

interface SheetViewerProps {
  content: MaterialFileContent
  fileName: string
  onError: () => void
}

interface LoadedSheet {
  xlsx: typeof import('xlsx')
  workbook: import('xlsx').WorkBook
}

interface SheetRows {
  rows: unknown[][]
  truncated: boolean
}

const MAX_RENDERED_ROWS = 2_000

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toLocaleString()
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function isNumericText(value: unknown): boolean {
  if (typeof value === 'number') return true
  if (typeof value !== 'string') return false
  return /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?$/.test(value.trim())
}

function rowsForSheet(loaded: LoadedSheet, sheetName: string): SheetRows {
  const worksheet = loaded.workbook.Sheets[sheetName]
  const ref = worksheet?.['!ref']
  if (worksheet === undefined || ref === undefined) {
    return { rows: [], truncated: false }
  }

  const originalRange = loaded.xlsx.utils.decode_range(ref)
  const totalRows = originalRange.e.r - originalRange.s.r + 1
  const limitedRange = {
    s: originalRange.s,
    e: {
      c: originalRange.e.c,
      r: Math.min(originalRange.e.r, originalRange.s.r + MAX_RENDERED_ROWS - 1)
    }
  }
  const rows = loaded.xlsx.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    range: limitedRange,
    defval: '',
    blankrows: true,
    raw: false
  })
  return { rows, truncated: totalRows > MAX_RENDERED_ROWS }
}

export function SheetViewer({
  content,
  fileName,
  onError
}: SheetViewerProps): JSX.Element {
  const [loaded, setLoaded] = useState<LoadedSheet | null>(null)
  const [activeSheet, setActiveSheet] = useState('')
  const tabIdPrefix = useId()

  useEffect(() => {
    let cancelled = false
    setLoaded(null)
    setActiveSheet('')

    void import('xlsx')
      .then((xlsx) => {
        const workbook = xlsx.read(content.data, {
          type: content.encoding === 'base64' ? 'base64' : 'string'
        })
        if (cancelled) return
        setLoaded({ xlsx, workbook })
        setActiveSheet(workbook.SheetNames[0] ?? '')
      })
      .catch(() => {
        if (!cancelled) onError()
      })

    return () => {
      cancelled = true
    }
  }, [content, onError])

  const sheetRows = useMemo(
    () =>
      loaded === null
        ? { rows: [], truncated: false }
        : rowsForSheet(loaded, activeSheet),
    [activeSheet, loaded]
  )

  if (loaded === null) {
    return (
      <div className="file-status" role="status">
        스프레드시트를 읽는 중…
      </div>
    )
  }

  const maxColumns = sheetRows.rows.reduce(
    (maximum, row) => Math.max(maximum, row.length),
    0
  )
  const headerRow = sheetRows.rows[0] ?? []
  const bodyRows = sheetRows.rows.slice(1)
  const panelId = `${tabIdPrefix}-panel`
  const activeSheetIndex = loaded.workbook.SheetNames.indexOf(activeSheet)

  const selectSheet = (index: number): void => {
    const sheetName = loaded.workbook.SheetNames[index]
    if (sheetName === undefined) return
    setActiveSheet(sheetName)
    window.requestAnimationFrame(() => {
      document.getElementById(`${tabIdPrefix}-tab-${index}`)?.focus()
    })
  }

  return (
    <div className="file-sheet">
      <div className="file-sheet__toolbar">
        <div className="file-sheet__tabs" role="tablist" aria-label="시트 선택">
          {loaded.workbook.SheetNames.map((sheetName, index) => {
            const tabId = `${tabIdPrefix}-tab-${index}`
            return (
              <button
                key={sheetName}
                id={tabId}
                type="button"
                className="file-sheet__tab"
                role="tab"
                aria-controls={panelId}
                aria-selected={sheetName === activeSheet}
                tabIndex={sheetName === activeSheet ? 0 : -1}
                onClick={() => setActiveSheet(sheetName)}
                onKeyDown={(event) => {
                  let nextIndex: number | null = null
                  if (event.key === 'ArrowLeft') {
                    nextIndex =
                      (index - 1 + loaded.workbook.SheetNames.length) %
                      loaded.workbook.SheetNames.length
                  } else if (event.key === 'ArrowRight') {
                    nextIndex = (index + 1) % loaded.workbook.SheetNames.length
                  } else if (event.key === 'Home') {
                    nextIndex = 0
                  } else if (event.key === 'End') {
                    nextIndex = loaded.workbook.SheetNames.length - 1
                  }
                  if (nextIndex !== null) {
                    event.preventDefault()
                    selectSheet(nextIndex)
                  }
                }}
              >
                {sheetName}
              </button>
            )
          })}
        </div>
        {sheetRows.truncated && (
          <p className="file-notice" role="status">
            처음 2,000행만 표시합니다.
          </p>
        )}
      </div>

      <div
        id={panelId}
        className="file-sheet__viewport"
        role="tabpanel"
        aria-label={activeSheetIndex < 0 ? `${fileName} 시트 내용` : undefined}
        aria-labelledby={
          activeSheetIndex < 0
            ? undefined
            : `${tabIdPrefix}-tab-${activeSheetIndex}`
        }
      >
        {sheetRows.rows.length === 0 || maxColumns === 0 ? (
          <div className="file-status">빈 시트입니다.</div>
        ) : (
          <table className="file-sheet__table">
            <caption className="file-visually-hidden">
              {fileName}의 {activeSheet} 시트
            </caption>
            <thead>
              <tr>
                {Array.from({ length: maxColumns }, (_, columnIndex) => {
                  const value = headerRow[columnIndex]
                  return (
                    <th
                      key={columnIndex}
                      scope="col"
                      className={
                        isNumericText(value)
                          ? 'file-sheet__cell--number'
                          : undefined
                      }
                    >
                      {cellText(value)}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {Array.from({ length: maxColumns }, (_, columnIndex) => {
                    const value = row[columnIndex]
                    return (
                      <td
                        key={columnIndex}
                        className={
                          isNumericText(value)
                            ? 'file-sheet__cell--number'
                            : undefined
                        }
                      >
                        {cellText(value)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
