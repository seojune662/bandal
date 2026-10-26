type Rect = Pick<DOMRectReadOnly, 'left' | 'right' | 'top' | 'bottom'>
type ChromeRect = Rect & { side: 'left' | 'right' }

const HEADER = '.dv-tabs-and-actions-container'
const CHROME_HEIGHT = 44

function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/** Read the fixed controls themselves: sidebar widths and fullscreen alter their overlap. */
function chromeRects(): ChromeRect[] {
  const rects: ChromeRect[] = []
  for (const [selector, side] of [['.shell-chrome', 'left'], ['.workspace-controls', 'right']] as const) {
    const element = document.querySelector<HTMLElement>(selector)
    if (!element || element.closest('[hidden]')) continue
    const rect = element.getBoundingClientRect()
    if (!(rect.right > rect.left && rect.bottom > rect.top)) continue
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    // The control capsule sits 5px inside the 44px window-control row. Reserve
    // that row vertically, without imposing it on unrelated panes or sidebars.
    rects.push({ left: rect.left, right: rect.right, top: Math.min(0, rect.top), bottom: Math.max(CHROME_HEIGHT, rect.bottom), side })
    if (side === 'right' && document.documentElement.dataset.platform === 'win32' && document.documentElement.dataset.fullscreen !== 'true') {
      rects.push({ left: rect.right, right: window.innerWidth, top: 0, bottom: CHROME_HEIGHT, side })
    }
  }
  return rects
}

/** Hidden tab bars still leave native page hit regions clear of the fixed controls. */
export function workspaceContentTopInset(rect: Rect): number {
  return chromeRects().reduce((inset, chrome) => intersects(rect, chrome) ? Math.max(inset, chrome.bottom - rect.top) : inset, 0)
}

/** Update before both adaptive tab sizing and Dockview minimum-width calculations. */
export function updateWorkspaceHeaderChromeInsets(root: ParentNode): boolean {
  const controls = chromeRects()
  let changed = false
  for (const header of root.querySelectorAll<HTMLElement>(HEADER)) {
    const rect = header.getBoundingClientRect()
    let left = 0, right = 0
    if (!header.closest('.workspace-course[hidden]') && rect.right > rect.left && rect.bottom > rect.top) {
      for (const chrome of controls) {
        if (!intersects(rect, chrome)) continue
        if (chrome.side === 'left') left = Math.max(left, Math.min(rect.right, chrome.right) - rect.left)
        else right = Math.max(right, rect.right - Math.max(rect.left, chrome.left))
      }
    }
    for (const [name, value] of [['--workspace-chrome-left', left], ['--workspace-chrome-right', right]] as const) {
      const css = `${Math.ceil(value)}px`
      if (header.style.getPropertyValue(name) === css) continue
      header.style.setProperty(name, css)
      changed = true
    }
  }
  return changed
}

/** Tracks layout only; the live editor and native browser owners remain mounted. */
export function installWorkspaceChromeInsets(root: HTMLElement, onChange?: () => void): () => void {
  const shell = root.closest('.app-shell') ?? document.body
  const observed = new Set<Element>()
  const transitions = new Map<EventTarget, Set<string>>()
  let frame = 0
  let previousGeometry = ''
  const schedule = (): void => { if (!frame) frame = requestAnimationFrame(update) }
  const resize = new ResizeObserver(schedule)
  const update = (): void => {
    frame = 0
    const current = new Set<Element>([root, ...root.querySelectorAll(`${HEADER}, .dv-groupview`), ...document.querySelectorAll('.shell-chrome, .workspace-controls')])
    for (const element of observed) if (!current.has(element)) { resize.unobserve(element); observed.delete(element) }
    for (const element of current) if (!observed.has(element)) { resize.observe(element); observed.add(element) }
    updateWorkspaceHeaderChromeInsets(root)
    const geometry = [...chromeRects(), ...[...current].map(element => element.getBoundingClientRect())]
      .map(rect => `${rect.left},${rect.right},${rect.top},${rect.bottom}`).join(';')
    // Content can move under the controls even when every tab bar is hidden.
    if (geometry !== previousGeometry) { previousGeometry = geometry; onChange?.() }
    for (const target of transitions.keys()) if (target instanceof Element && !target.isConnected) transitions.delete(target)
    if (transitions.size) schedule()
  }
  const mutations = new MutationObserver(records => {
    if (records.some(record => record.type !== 'attributes' || record.attributeName !== 'style' ||
      record.target instanceof Element && !!record.target.querySelector(HEADER))) schedule()
  })
  mutations.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'style', 'data-workspace-chrome'] })
  const shellMutations = new MutationObserver(schedule)
  shellMutations.observe(shell, { childList: true, attributes: true, attributeFilter: ['class', 'style', 'data-left-rail', 'data-right-rail'] })
  const platformMutations = new MutationObserver(schedule)
  platformMutations.observe(document.documentElement, { attributes: true, attributeFilter: ['data-platform', 'data-fullscreen', 'data-rail-resizing'] })
  const transition = (event: Event): void => {
    const { propertyName } = event as TransitionEvent
    if (!event.target || !/^(?:grid-template-columns|width|min-width|max-width|left|right|inset.*|padding.*|margin.*|transform|gap)$/.test(propertyName)) return
    if (event.type === 'transitionrun') {
      const properties = transitions.get(event.target) ?? new Set<string>()
      properties.add(propertyName)
      transitions.set(event.target, properties)
    } else {
      const properties = transitions.get(event.target)
      properties?.delete(propertyName)
      if (!properties?.size) transitions.delete(event.target)
    }
    schedule()
  }
  for (const name of ['transitionrun', 'transitionend', 'transitioncancel']) shell.addEventListener(name, transition)
  window.addEventListener('resize', schedule)
  update()
  return () => {
    cancelAnimationFrame(frame)
    resize.disconnect(); mutations.disconnect(); shellMutations.disconnect(); platformMutations.disconnect()
    for (const name of ['transitionrun', 'transitionend', 'transitioncancel']) shell.removeEventListener(name, transition)
    window.removeEventListener('resize', schedule)
  }
}
