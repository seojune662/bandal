import { useEffect, useState } from 'react'
import { Folder } from 'lucide-react'

import type { Settings } from '../../../../../shared/types/settings'
import { showToast } from '../../../app/toast'
import { Button } from '../../../components/ui/button'
import { useConfirm } from '../../../components/ui/confirm-dialog-context'
import { useT } from '../../../i18n'
import { invoke } from '../../../lib/ipc'
import { SettingsGroup, SettingsRow, SettingsStack } from '../kit/SettingsKit'

function displayDataRoot(path: string | undefined, fallback: string): string {
  if (path === undefined || path.length === 0) return fallback
  // Show the home-relative form for macOS defaults; other paths stay verbatim.
  const home = /^\/Users\/[^/]+(\/.*)$/.exec(path)
  return home ? `~${home[1]}` : path
}

function rejectedMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  if (typeof error === 'string' && error.trim().length > 0) return error
  return fallback
}

export function AdvancedPanel({ settings }: { settings: Settings | null }): JSX.Element {
  const t = useT()
  const confirm = useConfirm()
  const [pickedDataRoot, setPickedDataRoot] = useState<string | null>(null)
  const [pickingDataRoot, setPickingDataRoot] = useState(false)
  const [dataRootError, setDataRootError] = useState<string | null>(null)
  const [clearingCache, setClearingCache] = useState(false)
  const [resetting, setResetting] = useState(false)

  useEffect(() => setPickedDataRoot(null), [settings?.dataRoot])

  // A new data folder applies live (course creation reads settings.dataRoot
  // on each call), so no restart notice is needed here.
  const handlePickDataRoot = (): void => {
    if (pickingDataRoot) return
    setPickingDataRoot(true)
    setDataRootError(null)
    void invoke('settings:pickDataRoot', {})
      .then(result => {
        if (result !== null) setPickedDataRoot(result.dataRoot)
      })
      .catch((error: unknown) => {
        setDataRootError(rejectedMessage(error, t('settings.general.workspace.pickFailed')))
      })
      .finally(() => setPickingDataRoot(false))
  }

  const handleClearCache = (): void => {
    if (clearingCache) return
    setClearingCache(true)
    void invoke('app:clearCache', {})
      .then(() => showToast(t('settings.advanced.cache.cleared')))
      .catch(() => showToast(t('settings.advanced.cache.clearFailed'), 'danger'))
      .finally(() => setClearingCache(false))
  }

  const handleReset = async (): Promise<void> => {
    if (resetting) return
    const confirmed = await confirm({
      title: t('settings.advanced.reset.confirmTitle'),
      description: t('settings.advanced.reset.confirmDescription'),
      confirmLabel: t('settings.advanced.reset.action'),
      cancelLabel: t('settings.advanced.reset.cancel'),
      confirmVariant: 'destructive'
    })
    if (!confirmed) return
    setResetting(true)
    void invoke('settings:reset', {})
      .then(() => showToast(t('settings.advanced.reset.done')))
      .catch(() => showToast(t('settings.advanced.reset.failed'), 'danger'))
      .finally(() => setResetting(false))
  }

  const dataRoot = displayDataRoot(
    pickedDataRoot ?? settings?.dataRoot,
    t('settings.advanced.dataRoot.default')
  )

  return (
    <SettingsStack>
      <SettingsGroup searchId="advanced.dataRoot">
        <SettingsRow
          searchId="advanced.dataRoot.location"
          control={
            <Button variant="secondary" size="sm" disabled={pickingDataRoot} onClick={handlePickDataRoot}>
              {t(pickingDataRoot ? 'settings.general.workspace.picking' : 'settings.general.workspace.change')}
            </Button>
          }
          footer={
            <div className="space-y-1.5">
              <div
                className="flex h-(--control-height) min-w-0 items-center gap-2 rounded-md border border-border bg-secondary px-3 text-muted-foreground"
                aria-label={t('settings.general.workspace.directoryLabel')}
              >
                <Folder className="size-4 shrink-0" aria-hidden />
                <input
                  type="text"
                  readOnly
                  value={dataRoot}
                  title={dataRoot}
                  aria-label={t('settings.general.workspace.pathLabel')}
                  className="min-w-0 flex-1 truncate bg-transparent font-mono text-xs text-foreground outline-none select-text"
                />
              </div>
              {dataRootError !== null && (
                <p role="alert" className="text-xs text-destructive">
                  {dataRootError}
                </p>
              )}
            </div>
          }
        />
      </SettingsGroup>

      <SettingsGroup searchId="advanced.maintenance">
        <SettingsRow
          searchId="advanced.maintenance.logs"
          control={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void invoke('app:openLogs', {}).catch(() =>
                  showToast(t('settings.advanced.logs.openFailed'), 'danger')
                )
              }}
            >
              {t('settings.advanced.logs.open')}
            </Button>
          }
        />
        <SettingsRow
          searchId="advanced.maintenance.cache"
          control={
            <Button variant="secondary" size="sm" disabled={clearingCache} onClick={handleClearCache}>
              {t(clearingCache ? 'settings.advanced.cache.clearing' : 'settings.advanced.cache.clear')}
            </Button>
          }
        />
        <SettingsRow
          searchId="advanced.maintenance.reset"
          control={
            <Button
              variant="destructive-outline"
              size="sm"
              disabled={resetting}
              onClick={() => void handleReset()}
            >
              {t(resetting ? 'settings.advanced.reset.resetting' : 'settings.advanced.reset.action')}
            </Button>
          }
        />
      </SettingsGroup>
    </SettingsStack>
  )
}
