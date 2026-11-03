import { useState, type ReactNode } from 'react'
import { RotateCwIcon } from 'lucide-react'

import { Button } from '../../../components/ui/button'
import { useT } from '../../../i18n'
import { invoke } from '../../../lib/ipc'
import { SettingsNotice } from './SettingsKit'

/**
 * Orca's restart-required banner: shown only while a change is saved but not
 * yet live (`pending`), with a relaunch button. Attach it only to settings
 * that genuinely need a restart — today that is macOS Screen Recording.
 */
export function RestartRequiredBanner({
  pending,
  children
}: {
  pending: boolean
  children: ReactNode
}): JSX.Element | null {
  const t = useT()
  const [state, setState] = useState<'idle' | 'restarting' | 'failed'>('idle')
  if (!pending) return null
  return (
    <SettingsNotice
      tone="warning"
      icon={<RotateCwIcon />}
      action={
        <Button
          size="sm"
          variant="secondary"
          disabled={state === 'restarting'}
          onClick={() => {
            setState('restarting')
            void invoke('app:relaunch', {}).catch(() => setState('failed'))
          }}
        >
          {t(state === 'restarting' ? 'settings.restart.restarting' : 'settings.restart.now')}
        </Button>
      }
    >
      {state === 'failed' ? t('settings.restart.failed') : children}
    </SettingsNotice>
  )
}
