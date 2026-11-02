/**
 * Another device moved this profile's sync to the other storage (spec v2.7):
 * a toast once per move and launch, leading to Settings › 동기화, where the
 * banner moves this device too in one step.
 */
import { useEffect } from 'react'
import type { SyncProviderKind, SyncView } from '../../../../../shared/types/sync'
import { showToastWithAction } from '../../../app/toast'
import { invoke, onPush } from '../../../lib/ipc'
import { useUiStore } from '../../../stores/uiStore'

const NAME: Record<SyncProviderKind, string> = { icloud: 'iCloud', gdrive: 'Google Drive' }
/** Moves already told this launch, by their time. */
const told = new Set<number>()

export function SyncMoveNotice(): null {
  const openSettings = useUiStore(state => state.openSettings)
  useEffect(() => {
    const tell = (view: SyncView): void => {
      const moved = view.moved
      if (moved === null || !view.available[moved.provider] || told.has(moved.t)) return
      told.add(moved.t)
      const storage = `${NAME[moved.provider]}${moved.account_hint ? `(${moved.account_hint})` : ''}`
      showToastWithAction(`${moved.device}에서 ${storage}로 옮겼어요. 이 기기도 옮길까요?`, { label: '동기화 설정', run: () => openSettings('sync') })
    }
    void invoke('sync:status', {}).then(tell, () => {})
    const off = onPush('sync:changed', tell)
    return () => off()
  }, [openSettings])
  return null
}
