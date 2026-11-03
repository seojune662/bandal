import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import { useT } from '../../i18n'
import { invoke } from '../../lib/ipc'
import { SettingsEmptyState, SettingsGroup, SettingsNotice, SettingsRow } from './kit/SettingsKit'

export function PluginDevelopmentPanel(): JSX.Element {
  const t = useT()
  const [folders, setFolders] = useState<Array<{ id: string; path: string }>>(
    [],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    void invoke('plugins:devFolders', {})
      .then((value) => {
        if (active) setFolders(value.folders)
      })
      .catch((failure: unknown) => {
        if (active) setError(String(failure))
      })
    return () => {
      active = false
    }
  }, [attempt])
  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await action()
      setAttempt((n) => n + 1)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <SettingsGroup
      bare
      title={t('settings.pluginDev.title')}
      description={t('settings.pluginDev.description')}
      action={
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const picked = await invoke('plugins:pickFolder', {})
              if (picked.path)
                await invoke('plugins:watchFolder', { path: picked.path })
            })
          }
        >
          {t('settings.pluginDev.connect')}
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="space-y-1 rounded-lg border border-border bg-secondary/60 px-4 py-3 font-mono text-2xs text-secondary-foreground select-text">
          <code className="block">pnpm plugin create my-plugin publisher.my-plugin</code>
          <code className="block">pnpm plugin pack my-plugin</code>
        </div>
        {error && <SettingsNotice tone="danger">{error}</SettingsNotice>}
        {folders.length === 0 ? (
          <SettingsEmptyState title={t('settings.pluginDev.empty')} className="py-5" />
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card/60">
            {folders.map((folder) => (
              <SettingsRow
                key={folder.id}
                label={folder.id}
                description={<code className="[overflow-wrap:anywhere]">{folder.path}</code>}
                control={
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(() => invoke('plugins:unwatchFolder', { id: folder.id }))
                    }
                  >
                    {t('settings.pluginDev.stop')}
                  </Button>
                }
              />
            ))}
          </div>
        )}
      </div>
    </SettingsGroup>
  )
}
