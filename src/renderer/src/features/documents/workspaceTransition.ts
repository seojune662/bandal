import { invoke, onPush } from '../../lib/ipc'
import { prepareUpdateInstall } from '../updates/prepareUpdateInstall'

/** Installed before rendering the login gate, so an empty locked workspace can
 * acknowledge a transition without attempting protected document reads. */
export function installWorkspaceTransition(root: HTMLElement): () => void {
  let active: string | null = null
  const frozen = new Map<HTMLElement, boolean>()
  let portals: MutationObserver | null = null
  const freeze = (element: HTMLElement): void => {
    if (!frozen.has(element)) frozen.set(element, element.inert)
    element.inert = true
  }
  const release = (): void => {
    portals?.disconnect(); portals = null
    for (const [element, previous] of frozen) element.inert = previous
    frozen.clear(); active = null
  }
  // Focus moves to the body when its previous target becomes inert. Global
  // keyboard shortcuts must not create another editor during the save drain.
  const blockShortcut = (event: KeyboardEvent): void => {
    if (active !== null) { event.preventDefault(); event.stopImmediatePropagation() }
  }
  window.addEventListener('keydown', blockShortcut, true)
  const prepare = onPush('workspace:prepareTransition', ({ requestId }) => {
    if (active !== null) {
      void invoke('workspace:transitionReady', { requestId, ok: false }).catch(() => {})
      return
    }
    active = requestId
    freeze(root)
    for (const child of document.body.children) if (child instanceof HTMLElement) freeze(child)
    portals = new MutationObserver(records => {
      if (active === null) return
      for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLElement) freeze(node)
    })
    portals.observe(document.body, { childList: true })
    void (async () => {
      let ok = false
      try { await prepareUpdateInstall(); ok = true } catch { /* Main receives a fixed failure, never document contents. */ }
      if (active === requestId) await invoke('workspace:transitionReady', { requestId, ok }).catch(() => {})
    })()
  })
  const finished = onPush('workspace:releaseTransition', ({ requestId }) => { if (active === requestId) release() })
  return () => { prepare(); finished(); release(); window.removeEventListener('keydown', blockShortcut, true) }
}
