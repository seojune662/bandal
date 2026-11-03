/**
 * Deep-link scrolling for settings rows. The watcher is Orca's
 * settings-deep-link-target-watcher.ts (MIT): rows that mount late (async
 * panels) are awaited with a MutationObserver for up to 5s.
 */

const TARGET_WAIT_TIMEOUT_MS = 5000
export const SETTINGS_TARGET_HIGHLIGHT_MS = 3000

function findTarget(root: ParentNode, sectionId: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-settings-target="${CSS.escape(sectionId)}"]`)
}

function reveal(target: HTMLElement): () => void {
  // Disclosure rows (<details>) hide their content until opened.
  const details = target.closest('details')
  if (details !== null) details.open = true
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  target.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' })
  target.setAttribute('data-highlighted', 'true')
  const timer = window.setTimeout(() => target.removeAttribute('data-highlighted'), SETTINGS_TARGET_HIGHLIGHT_MS)
  return () => {
    window.clearTimeout(timer)
    target.removeAttribute('data-highlighted')
  }
}

/** Scroll to and highlight `sectionId` inside `root`; returns a cancel fn. */
export function revealSettingsTarget(root: HTMLElement, sectionId: string): () => void {
  let clearHighlight: (() => void) | null = null
  const present = findTarget(root, sectionId)
  if (present !== null) {
    clearHighlight = reveal(present)
    return () => clearHighlight?.()
  }
  let settled = false
  const observer = new MutationObserver(() => {
    const target = findTarget(root, sectionId)
    if (settled || target === null) return
    finish()
    clearHighlight = reveal(target)
  })
  const timeout = window.setTimeout(() => finish(), TARGET_WAIT_TIMEOUT_MS)
  function finish(): void {
    settled = true
    observer.disconnect()
    window.clearTimeout(timeout)
  }
  observer.observe(root, { subtree: true, childList: true })
  return () => {
    finish()
    clearHighlight?.()
  }
}
