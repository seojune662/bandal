/**
 * [M3-F] JSX intrinsic for the Electron `<webview>` tag (renderer only).
 * The attribute surface is intentionally tiny: everything security-relevant
 * is forced main-side in will-attach-webview, so only src/partition matter.
 */

import type { DetailedHTMLProps, HTMLAttributes } from 'react'

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        partition?: string
        /**
         * Without this, Chromium drops window.open/target=_blank INSIDE the
         * guest — main's setWindowOpenHandler never even fires. With it, the
         * handler still denies the native window and forwards the URL as a
         * Bandal tab (hardenWebviews.ts), so popups stay contained.
         */
        allowpopups?: boolean
      }
    }
  }
}

export {}
