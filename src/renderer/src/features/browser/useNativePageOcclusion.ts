import { useEffect, useState } from 'react'

/** Native child views sit above DOM surfaces. Hide them while a shell dialog/menu is open. */
export function useNativePageOcclusion(): boolean {
  const [occluded, setOccluded] = useState(false)
  useEffect(() => {
    let frame = 0
    const update = (): void => {
      frame = 0
      const surfaces = document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"], dialog[open]')
      setOccluded([...surfaces].some(surface => surface.getClientRects().length > 0 && getComputedStyle(surface).visibility !== 'hidden'))
    }
    const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(update) })
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open', 'aria-hidden'] })
    update()
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [])
  return occluded
}
