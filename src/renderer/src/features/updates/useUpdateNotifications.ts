/**
 * Surfaces auto-update state as toasts in the workspace window.
 *
 * Only two phases are worth interrupting a student for: a new version exists,
 * and a downloaded one is waiting to be applied. Everything else (checking,
 * download progress, "already up to date") belongs in Settings → About, where
 * it is asked for rather than pushed.
 *
 * Errors are shown once per distinct message, because the 6-hour background
 * check would otherwise re-toast the same failure indefinitely.
 */

import { useEffect, useRef } from 'react'
import { showToast, showToastWithAction } from '../../app/toast'
import { useUpdateStore } from '../../stores/updateStore'

export function useUpdateNotifications(): void {
  const status = useUpdateStore((state) => state.status)
  const init = useUpdateStore((state) => state.init)
  const download = useUpdateStore((state) => state.download)
  const install = useUpdateStore((state) => state.install)

  // Toasts are fire-and-forget side effects, so re-entering the same phase
  // must not re-fire them. Keyed by phase+version rather than a bare boolean
  // so a *second* update released later still announces itself.
  const announced = useRef<string | null>(null)
  const lastError = useRef<string | null>(null)

  useEffect(() => {
    init()
  }, [init])

  useEffect(() => {
    if (status === null) return

    if (status.phase === 'available') {
      const key = `available:${status.version}`
      if (announced.current === key) return
      announced.current = key
      showToastWithAction(`새 버전 ${status.version} 이 있습니다`, {
        label: '업데이트',
        run: () => {
          void download()
        }
      })
      return
    }

    if (status.phase === 'ready') {
      const key = `ready:${status.version}`
      if (announced.current === key) return
      announced.current = key
      showToastWithAction(`${status.version} 준비 완료 — 재시작하면 적용됩니다`, {
        label: '재시작',
        run: () => {
          void install()
        }
      })
      return
    }

    if (status.phase === 'error') {
      if (lastError.current === status.message) return
      lastError.current = status.message
      showToast(status.message, 'danger')
    }
  }, [status, download, install])
}
