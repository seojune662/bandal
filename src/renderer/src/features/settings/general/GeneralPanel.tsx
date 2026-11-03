import { useState } from 'react'

import { Button } from '../../../components/ui/button'
import { LOCALES, setLocale, useLocale, useT, type Locale } from '../../../i18n'
import { invoke } from '../../../lib/ipc'
import type { Settings } from '../../../../../shared/types/settings'
import { reopenedOnboarding } from '../../onboarding/onboardingModel'
import { SettingsGroup, SettingsRow, SettingsSelectRow, SettingsStack, SettingsSwitchRow } from '../kit/SettingsKit'
import { savePreference } from '../savePreference'

type ResetState = 'idle' | 'done' | 'failed'

export function GeneralPanel({ settings }: { settings: Settings | null }): JSX.Element {
  const t = useT()
  const locale = useLocale()
  const [onboardingReset, setOnboardingReset] = useState<ResetState>('idle')
  const [tutorialReset, setTutorialReset] = useState<ResetState>('idle')

  const reopenOnboarding = (): void => {
    void invoke('settings:set', { onboarding: reopenedOnboarding() })
      .then(() => setOnboardingReset('done'))
      .catch(() => setOnboardingReset('failed'))
  }

  const replayTutorial = (): void => {
    // Fetch the current marker: an interrupted tour still needs guarded
    // cleanup before a replay can create another sample course.
    void invoke('settings:get', {})
      .then(current => invoke('settings:set', { tutorial: { ...current.tutorial, seenVersion: 0 } }))
      .then(() => setTutorialReset('done'))
      .catch(() => setTutorialReset('failed'))
  }

  return (
    <SettingsStack>
      <SettingsGroup searchId="general.language">
        <SettingsSelectRow
          searchId="general.language.app"
          description={`${t('settings.general.language.help')} ${t('settings.general.locale.scope')}`}
          value={locale}
          options={LOCALES.map(option => ({ value: option, label: t(`settings.locale.${option}`) }))}
          onChange={(next: Locale) => setLocale(next)}
        />
      </SettingsGroup>

      <SettingsGroup searchId="general.tabs">
        <SettingsSwitchRow
          searchId="general.tabs.openBeside"
          checked={settings?.openAdjacentTab ?? false}
          disabled={settings === null}
          onChange={openAdjacentTab => void savePreference({ openAdjacentTab })}
        />
        <SettingsSwitchRow
          searchId="general.tabs.restore"
          checked={settings?.restoreLastCourse ?? false}
          disabled={settings === null}
          onChange={restoreLastCourse => void savePreference({ restoreLastCourse })}
        />
      </SettingsGroup>

      <SettingsGroup searchId="general.onboarding">
        <SettingsRow
          searchId="general.onboarding.reopen"
          description={t(`settings.general.onboarding.${onboardingReset}`)}
          control={
            <Button variant="secondary" size="sm" onClick={reopenOnboarding}>
              {t('settings.general.onboarding.reopenAction')}
            </Button>
          }
        />
        <SettingsRow
          searchId="general.onboarding.tutorial"
          description={t(`settings.general.tutorial.${tutorialReset}`)}
          control={
            <Button variant="secondary" size="sm" onClick={replayTutorial}>
              {t('settings.general.tutorial.reopenAction')}
            </Button>
          }
        />
      </SettingsGroup>
    </SettingsStack>
  )
}
