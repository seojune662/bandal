import type { Settings } from '../../../../../shared/types/settings'
import { Badge } from '../../../components/ui/badge'
import { useT } from '../../../i18n'
import { SettingsGroup, SettingsStack, SettingsSwitchRow } from '../kit/SettingsKit'
import { savePreference } from '../savePreference'

export function ExperimentalPanel({ settings }: { settings: Settings | null }): JSX.Element {
  const t = useT()

  return (
    <SettingsStack>
      <SettingsGroup searchId="experimental.flags">
        {/* Applies live: settings:set starts/stops plugin hosts, no restart. */}
        <SettingsSwitchRow
          searchId="experimental.flags.extensionRuntime"
          badge={<Badge variant="warning">{t('settings.experimental.badge')}</Badge>}
          checked={settings?.experimental.extensionRuntime ?? false}
          disabled={settings === null}
          onChange={extensionRuntime => {
            if (settings === null) return
            void savePreference({ experimental: { extensionRuntime } })
          }}
        />
      </SettingsGroup>
    </SettingsStack>
  )
}
