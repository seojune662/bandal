export function waitForSwipe(state: () => { canBack: boolean; canForward: boolean; enabled: boolean }): Promise<'back' | 'forward'> {
  return new Promise(resolve => {
    let distance = 0, vertical = 0, last = 0, blocked = false, timer: ReturnType<typeof setTimeout> | undefined
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
          hint.style.cssText = 'position:fixed;top:45%;z-index:2147483647;border-radius:50%;width:48px;height:48px;display:grid;place-items:center;font:28px sans-serif;color:white;background:#42694e;pointer-events:none;box-shadow:0 3px 16px #0004;'
          document.documentElement.append(hint)
        }
        hint.style.left = distance < 0 ? '12px' : 'auto'
        hint.style.right = distance > 0 ? '12px' : 'auto'
        hint.style.opacity = String(Math.min(1, Math.abs(distance) / 160))
        hint.textContent = distance < 0 ? '‹' : '›'
      } else clear()
      timer = setTimeout(() => {
        clear()
        if (!blocked && available && Math.abs(distance) >= 160 && Math.abs(distance) > vertical * 1.5) {
          window.removeEventListener('wheel', wheel, true)
          resolve(distance < 0 ? 'back' : 'forward')
        }
      }, 180)
    }
    window.addEventListener('wheel', wheel, { capture: true, passive: false })
  })
}
