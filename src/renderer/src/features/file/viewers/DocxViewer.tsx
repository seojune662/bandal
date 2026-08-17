import { useEffect, useState } from 'react'

interface DocxViewerProps {
  base64: string
  fileName: string
  onError: () => void
}

type DocxState =
  | { status: 'loading' }
  | { status: 'ready'; html: string }

const BLOCKED_ELEMENTS =
  'script, iframe, object, embed, link, meta, base, form, input, button, textarea, select, svg, math'
const URL_ATTRIBUTES = new Set(['href', 'src', 'xlink:href', 'action', 'formaction'])
const DANGEROUS_SCHEME = /^(?:javascript|vbscript|file|data):/i
const INLINE_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,/i

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = window.atob(base64)
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return buffer
}

/** Defensive boundary for HTML produced from an untrusted external document. */
export function sanitizeDocxHtml(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html')

  document.querySelectorAll(BLOCKED_ELEMENTS).forEach((element) => element.remove())
  document.body.querySelectorAll('*').forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim()
      if (
        name.startsWith('on') ||
        name === 'style' ||
        name === 'srcdoc' ||
        name === 'srcset'
      ) {
        element.removeAttribute(attribute.name)
        continue
      }
      if (name === 'src' && value.length > 0 && !INLINE_IMAGE.test(value)) {
        element.removeAttribute(attribute.name)
        continue
      }
      if (
        name !== 'src' &&
        URL_ATTRIBUTES.has(name) &&
        DANGEROUS_SCHEME.test(value)
      ) {
        element.removeAttribute(attribute.name)
      }
    }

    if (element instanceof HTMLAnchorElement && element.hasAttribute('href')) {
      element.setAttribute('target', '_blank')
      element.setAttribute('rel', 'noopener noreferrer')
    }
  })

  return document.body.innerHTML
}

export function DocxViewer({
  base64,
  fileName,
  onError
}: DocxViewerProps): JSX.Element {
  const [state, setState] = useState<DocxState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    void import('mammoth')
      .then(async (mammoth) => {
        const result = await mammoth.default.convertToHtml(
          { arrayBuffer: base64ToArrayBuffer(base64) },
          { externalFileAccess: false }
        )
        if (!cancelled) {
          setState({ status: 'ready', html: sanitizeDocxHtml(result.value) })
        }
      })
      .catch(() => {
        if (!cancelled) onError()
      })

    return () => {
      cancelled = true
    }
  }, [base64, onError])

  if (state.status === 'loading') {
    return (
      <div className="file-status" role="status">
        Word 문서를 변환하는 중…
      </div>
    )
  }

  return (
    <div
      className="file-docx"
      role="region"
      aria-label={`${fileName} 문서 내용`}
    >
      <article
        className="file-docx__document"
        dangerouslySetInnerHTML={{ __html: state.html }}
      />
    </div>
  )
}
