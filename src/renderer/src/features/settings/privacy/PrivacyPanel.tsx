import { useState } from 'react'
import { FolderOpen } from 'lucide-react'

import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import type { DiagnosticsBundle } from '../../../../../shared/types/permissions'
import { OPEN_FEEDBACK_EVENT } from '../../help/FeedbackDialog'
import { showToast } from '../../../app/toast'
import { useT } from '../../../i18n'
import { invoke } from '../../../lib/ipc'
import { SettingsGroup, SettingsRow, SettingsStack } from '../kit/SettingsKit'

export function PrivacyPanel(): JSX.Element {
  const t = useT()
  const [creating, setCreating] = useState(false)
  const [bundle, setBundle] = useState<DiagnosticsBundle | null>(null)

  const createDiagnostics = (): void => {
    if (creating) return
    setCreating(true)
    void invoke('app:diagnostics', {})
      .then(setBundle)
      .catch(() => showToast(t('settings.privacy.diagnostics.failed'), 'danger'))
      .finally(() => setCreating(false))
  }

  const diagnosticsResult =
    bundle === null ? undefined : (
      <div className="space-y-2.5" aria-live="polite">
        <h3 className="text-xs font-medium text-foreground">{t('settings.privacy.diagnostics.contents')}</h3>
        <ul className="list-disc space-y-0.5 pl-5 text-xs leading-relaxed text-muted-foreground select-text">
          {bundle.contents.map((item, index) => (
            <li key={`${index}-${item}`}>{item}</li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <FolderOpen aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <Input
            type="text"
            value={bundle.path}
            aria-label={t('settings.privacy.diagnostics.pathLabel')}
            readOnly
            className="h-7 flex-1 font-mono text-xs"
            onFocus={event => event.currentTarget.select()}
          />
          <Badge variant="success">{t('settings.privacy.diagnostics.revealed')}</Badge>
        </div>
      </div>
    )

  return (
    <SettingsStack>
      <SettingsGroup searchId="privacy.data">
        <SettingsRow searchId="privacy.data.promise" />
      </SettingsGroup>

      <SettingsGroup searchId="privacy.diagnostics">
        <SettingsRow
          searchId="privacy.diagnostics.create"
          control={
            <Button variant="secondary" size="sm" disabled={creating} onClick={createDiagnostics}>
              {t(creating ? 'settings.privacy.diagnostics.creating' : 'settings.privacy.diagnostics.create')}
            </Button>
          }
          {...(diagnosticsResult !== undefined ? { footer: diagnosticsResult } : {})}
        />
      </SettingsGroup>

      <SettingsGroup searchId="privacy.feedback">
        <SettingsRow
          searchId="privacy.feedback.send"
          control={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => window.dispatchEvent(new CustomEvent(OPEN_FEEDBACK_EVENT))}
            >
              {t('settings.privacy.feedback.send')}
            </Button>
          }
        />
      </SettingsGroup>
    </SettingsStack>
  )
}
