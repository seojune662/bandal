/**
 * Loads a course material PDF over IPC (`materials:readFile`) and exposes it
 * as a data URL for react-pdf. A data URL (rather than a Uint8Array) is
 * deliberate: pdf.js transfers ArrayBuffers to its worker, which detaches
 * them — under React StrictMode's double-mount that breaks byte-array
 * sources, while string sources are safe to reuse.
 */

import { useEffect, useState } from 'react'
import { invoke } from '../../lib/ipc'

export type PdfDocumentState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; dataUrl: string }

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return '파일을 읽는 중 알 수 없는 오류가 발생했어요.'
}

export function usePdfDocument(
  courseId: string,
  relPath: string
): PdfDocumentState {
  const [state, setState] = useState<PdfDocumentState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    invoke('materials:readFile', { courseId, relPath })
      .then((content) => {
        if (cancelled) return
        if (content.encoding !== 'base64') {
          setState({
            status: 'error',
            message: 'PDF 파일이 아니거나 손상된 파일이에요.'
          })
          return
        }
        setState({
          status: 'ready',
          dataUrl: `data:application/pdf;base64,${content.data}`
        })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({ status: 'error', message: errorMessage(error) })
      })

    return () => {
      cancelled = true
    }
  }, [courseId, relPath])

  return state
}
