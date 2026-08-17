import { useEffect, useState } from 'react'
import type { DockviewPanelApi } from 'dockview'

function isShown(api: DockviewPanelApi): boolean {
  return api.isActive && api.isVisible
}

/**
 * Latches once the panel is both its group's active tab and in a visible group.
 */
export function useHasBeenShown(api: DockviewPanelApi): boolean {
  const [hasBeenShown, setHasBeenShown] = useState(() => isShown(api))

  useEffect(() => {
    if (hasBeenShown) return

    const update = (): void => {
      if (isShown(api)) setHasBeenShown(true)
    }
    const activeDisposable = api.onDidActiveChange(update)
    const visibleDisposable = api.onDidVisibilityChange(update)

    // Cover a state change between the initial render and effect subscription.
    update()

    return () => {
      activeDisposable.dispose()
      visibleDisposable.dispose()
    }
  }, [api, hasBeenShown])

  return hasBeenShown
}
