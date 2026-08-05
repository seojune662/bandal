/**
 * pdf.js worker wiring for electron-vite.
 *
 * `?url` makes Vite emit the worker file as an asset and hand us its URL —
 * dev server serves it from node_modules, production build copies it into
 * the renderer output. `pdfjs-dist` is a direct dependency pinned to the
 * exact version react-pdf resolves (4.8.69) so the API and worker versions
 * always match (mismatch is a hard pdf.js error).
 *
 * Import this module once from any PDF component before rendering
 * <Document> — it is side-effect only and idempotent.
 */

import { pdfjs } from 'react-pdf'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

if (pdfjs.GlobalWorkerOptions.workerSrc !== workerUrl) {
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
}
