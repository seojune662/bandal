import type { WebContents } from 'electron'

// Remote sites sometimes share styles with their desktop apps. Electron treats
// app-region: drag as native window chrome even in a WebContentsView: it eats
// hover and clicks before Chromium can dispatch DOM input. Only Bandal's local
// shell may define window drag regions; normal web content must behave as it
// does in a browser tab. User origin also overrides inline author !important.
// Reset to the initial value, rather than adding a native no-drag rectangle
// for every element in the document.
const PAGE_INPUT_CSS = `
  *, *::before, *::after {
    -webkit-app-region: initial !important;
    app-region: initial !important;
  }
`

export function attachBrowserPageInputPolicy(page: WebContents): void {
  const apply = (): void => {
    if (page.isDestroyed()) return
    void page.insertCSS(PAGE_INPUT_CSS, { cssOrigin: 'user' }).catch(() => {
      // A navigation or closed popup can discard the document while inserting.
      // Its replacement receives the policy on its own dom-ready.
    })
  }
  page.on('dom-ready', apply)
  // Adopted popups and pages already displaying a document need the policy too.
  apply()
}
