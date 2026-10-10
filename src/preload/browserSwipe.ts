export interface BrowserSwipeState {
  canBack: boolean
  canForward: boolean
  enabled: boolean
  theme: 'light' | 'dark'
}

export function waitForSwipe(state: () => BrowserSwipeState): Promise<'back' | 'forward'> {
  return new Promise(resolve => {
    let distance = 0, vertical = 0, last = -Infinity, blocked = false, timer: ReturnType<typeof setTimeout> | undefined
    let hint: HTMLElement | null = null
    const clear = (): void => { hint?.remove(); hint = null }
    const scrolls = (event: WheelEvent): boolean => {
      for (const item of event.composedPath()) {
        if (!(item instanceof Element)) continue
        const css = getComputedStyle(item)
        if (css.overscrollBehaviorX === 'contain' || css.overscrollBehaviorX === 'none') return true
        if (!/(auto|scroll)/.test(css.overflowX) || item.scrollWidth <= item.clientWidth + 1) continue
        const max = item.scrollWidth - item.clientWidth
        const x = item.scrollLeft
        if (css.direction === 'rtl' ? (event.deltaX < 0 ? x > -max + 1 : x < -1) : (event.deltaX < 0 ? x > 1 : x < max - 1)) return true
      }
      return false
    }
    const wheel = (event: WheelEvent): void => {
      if (!event.isTrusted) return
      const now = performance.now()
      if (now - last > 220) { distance = 0; vertical = 0; blocked = scrolls(event); clear() }
      last = now
      clearTimeout(timer)
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.deltaMode !== 0) blocked = true
      distance += event.deltaX
      vertical += Math.abs(event.deltaY)
      if (vertical > 12 && vertical > Math.abs(distance) / 1.5) blocked = true
      const flags = state()
      const available = flags.enabled && (distance < 0 ? flags.canBack : flags.canForward)
      if (!blocked && available && Math.abs(distance) > 12 && Math.abs(distance) > vertical * 1.5) {
        event.preventDefault()
        if (!hint) {
          hint = document.createElement('div')
          hint.setAttribute('aria-hidden', 'true')
          hint.style.cssText = 'all:initial;position:fixed;top:45%;z-index:2147483647;border-radius:50%;width:44px;height:44px;display:grid;place-items:center;pointer-events:none;box-shadow:0 3px 16px #0003;'
          document.documentElement.append(hint)
        }
        // Use the app's neutral theme, never the page CSS or course accent.
        hint.style.color = flags.theme === 'dark' ? '#171717' : '#ffffff'
        hint.style.backgroundColor = flags.theme === 'dark' ? '#ececec' : '#171717'
        hint.style.left = distance < 0 ? '12px' : 'auto'
        hint.style.right = distance > 0 ? '12px' : 'auto'
        hint.style.opacity = String(Math.min(1, Math.abs(distance) / 160))
        hint.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${distance < 0 ? 'M14 6l-6 6 6 6' : 'M10 6l6 6-6 6'}"/></svg>`
      } else clear()
      timer = setTimeout(() => {
        clear()
        if (!blocked && available && Math.abs(distance) >= 160 && Math.abs(distance) > vertical * 1.5) {
          window.removeEventListener('wheel', wheel, true)
          resolve(distance < 0 ? 'back' : 'forward')
        }
        distance = 0; vertical = 0; last = -Infinity; blocked = false
      }, 180)
    }
    window.addEventListener('wheel', wheel, { capture: true, passive: false })
  })
}
