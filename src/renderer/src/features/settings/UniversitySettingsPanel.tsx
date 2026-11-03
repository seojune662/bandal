import { useEffect, useId, useState } from 'react'
import { ArrowDown, ArrowUp, Bookmark } from 'lucide-react'

import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Switch } from '../../components/ui/switch'
import { SimpleTooltip } from '../../components/ui/tooltip'
import type {
  ExternalReason,
  ServiceKind,
  University,
  UniversityService,
  VerificationLevel
} from '../../../../shared/types/university'
import { useLocale, useT } from '../../i18n'
import { useUniversityStore } from '../../stores/universityStore'
import { SettingsEmptyState, SettingsGroup, SettingsRow, SettingsStack } from './kit/SettingsKit'
import { SettingsUniversityPicker } from './SettingsUniversityPicker'
import { SavedLoginsSettings } from './SavedLoginsSettings'

type Translator = ReturnType<typeof useT>
type CurrentLocale = ReturnType<typeof useLocale>

function universityName(university: University, locale: CurrentLocale): string {
  return locale === 'en-US' && university.nameEn.length > 0 ? university.nameEn : university.nameKo
}

function serviceName(service: UniversityService, locale: CurrentLocale): string {
  return locale === 'en-US' && service.labelEn !== undefined ? service.labelEn : service.label
}

function verifiedAtLabel(t: Translator, verifiedAt: string): string {
  return verifiedAt.length === 0
    ? t('settings.university.noVerifiedAt')
    : t('settings.university.verifiedAt', { date: verifiedAt })
}

function verificationBadge(t: Translator, level: VerificationLevel): string | null {
  switch (level) {
    case 'verified':
      return null
    case 'partial':
      return t('settings.university.verification.partial')
    case 'unverified':
      return t('settings.university.verification.unverified')
  }
}

function serviceKindLabel(t: Translator, kind: ServiceKind): string {
  return t(`settings.university.kind.${kind}`)
}

function externalReasonMessage(t: Translator, reason: ExternalReason | undefined): string {
  switch (reason) {
    case 'federated-login':
      return t('settings.university.external.federated-login')
    case 'ua-sniffing':
      return t('settings.university.external.ua-sniffing')
    case 'native-plugin':
      return t('settings.university.external.native-plugin')
    default:
      return t('settings.university.external.default')
  }
}

/** A labelled inline switch inside a service row (several per row, so no SettingsSwitchRow). */
function InlineSwitch({
  label,
  ariaLabel,
  checked,
  disabled,
  onChange
}: {
  label: string
  ariaLabel: string
  checked: boolean
  disabled: boolean
  onChange: (next: boolean) => void
}): JSX.Element {
  const id = useId()
  return (
    <span className="inline-flex items-center gap-1.5">
      <label htmlFor={id} className="text-2xs text-muted-foreground">
        {label}
      </label>
      <Switch id={id} aria-label={ariaLabel} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </span>
  )
}

export function UniversitySettingsPanel(): JSX.Element {
  const t = useT()
  const locale = useLocale()
  const loaded = useUniversityStore((state) => state.loaded)
  const settings = useUniversityStore((state) => state.settings)
  const university = useUniversityStore((state) => state.university)
  const services = useUniversityStore((state) => state.services)
  const error = useUniversityStore((state) => state.error)
  const init = useUniversityStore((state) => state.init)
  const selectPreset = useUniversityStore((state) => state.selectPreset)
  const addCustom = useUniversityStore((state) => state.addCustom)
  const clearSelection = useUniversityStore((state) => state.clearSelection)
  const setServiceHidden = useUniversityStore((state) => state.setServiceHidden)
  const setOpenExternally = useUniversityStore((state) => state.setOpenExternally)
  const moveService = useUniversityStore((state) => state.moveService)
  const setServiceSecondary = useUniversityStore((state) => state.setServiceSecondary)
  const resetServiceLayout = useUniversityStore((state) => state.resetServiceLayout)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void init()
  }, [init])

  const run = async (work: () => Promise<void>): Promise<boolean> => {
    setBusy(true)
    try {
      await work()
      return useUniversityStore.getState().error === null
    } finally {
      setBusy(false)
    }
  }

  const hiddenIds = settings.hiddenServiceIds
  const hiddenPresets = (university?.services ?? []).filter((service) => hiddenIds.includes(service.id))
  const serviceGroups = [
    {
      id: 'primary',
      services: services.filter((service) => !service.secondary)
    },
    {
      id: 'secondary',
      services: services.filter((service) => service.secondary)
    }
  ] as const

  const renderService = (service: UniversityService, index: number, count: number): JSX.Element => {
    const badge = verificationBadge(t, service.verification)
    const label = serviceName(service, locale)
    const moveUpLabel = t('settings.university.moveUp', { name: label })
    const moveDownLabel = t('settings.university.moveDown', { name: label })
    return (
      <SettingsRow
        key={service.id}
        label={label}
        badge={
          <>
            <Badge variant="outline">{serviceKindLabel(t, service.kind)}</Badge>
            {badge !== null && <Badge variant="warning">{badge}</Badge>}
          </>
        }
        description={
          service.opensExternally
            ? externalReasonMessage(t, service.externalReason)
            : locale === 'ko-KR'
              ? (service.note ?? service.url)
              : service.url
        }
        control={
          <>
            <div
              className="flex items-center gap-0.5"
              role="group"
              aria-label={t('settings.university.reorder', { name: label })}
            >
              <SimpleTooltip label={moveUpLabel}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={moveUpLabel}
                  disabled={busy || index === 0}
                  onClick={() => void run(() => moveService(service.id, -1))}
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
              </SimpleTooltip>
              <SimpleTooltip label={moveDownLabel}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={moveDownLabel}
                  disabled={busy || index === count - 1}
                  onClick={() => void run(() => moveService(service.id, 1))}
                >
                  <ArrowDown aria-hidden="true" />
                </Button>
              </SimpleTooltip>
            </div>
            <InlineSwitch
              label={t('settings.university.openExternalLabel')}
              ariaLabel={t('settings.university.openExternal', { name: label })}
              checked={service.opensExternally === true}
              disabled={busy}
              onChange={(next) => void run(() => setOpenExternally(service.id, next))}
            />
            <InlineSwitch
              label={t('settings.university.moreLabel')}
              ariaLabel={t('settings.university.secondaryToggle', { name: label })}
              checked={service.secondary === true}
              disabled={busy}
              onChange={(next) => void run(() => setServiceSecondary(service.id, next))}
            />
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void run(() => setServiceHidden(service.id, true))}
            >
              {t('settings.university.hide')}
            </Button>
          </>
        }
      />
    )
  }

  const serviceGroupProps = (group: (typeof serviceGroups)[number]): {
    bare: boolean
    action: JSX.Element
    children: JSX.Element | JSX.Element[]
  } => ({
    bare: group.services.length === 0,
    action: <Badge variant="default">{new Intl.NumberFormat(locale).format(group.services.length)}</Badge>,
    children:
      group.services.length === 0 ? (
        <SettingsEmptyState
          icon={<Bookmark />}
          title={t(`settings.university.${group.id}.empty`)}
          description={t(`settings.university.${group.id}.emptyHelp`)}
        />
      ) : (
        group.services.map((service, index) => renderService(service, index, group.services.length))
      )
  })

  return (
    <SettingsStack>
      <SettingsGroup
        searchId="university.school"
        description={
          university === null
            ? t('settings.university.mine.emptyHelp')
            : t('settings.university.mine.selected', {
                name: universityName(university, locale),
                verifiedAt: verifiedAtLabel(t, university.verifiedAt)
              })
        }
      >
        <SettingsRow
          searchId="university.school.picker"
          alignTop
          description={
            error !== null ? (
              <span className="text-destructive" role="alert">
                {t('settings.university.saveError')}
              </span>
            ) : undefined
          }
          footer={
            !loaded ? (
              <p role="status" className="text-xs text-muted-foreground">
                {t('settings.university.loading')}
              </p>
            ) : (
              <SettingsUniversityPicker
                selectedId={settings.universityId}
                customName={settings.customUniversity?.nameKo}
                busy={busy}
                onSelectPreset={(id) => void run(() => selectPreset(id))}
                onAddCustom={(input) => run(() => addCustom(input))}
              />
            )
          }
        />
        {university !== null && (
          <SettingsRow
            searchId="university.school.clear"
            control={
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(() => clearSelection())}>
                {t('settings.university.clear')}
              </Button>
            }
          />
        )}
      </SettingsGroup>

      {university !== null && (
        <SettingsGroup searchId="university.primary" {...serviceGroupProps(serviceGroups[0])} />
      )}
      {university !== null && (
        <SettingsGroup searchId="university.secondary" {...serviceGroupProps(serviceGroups[1])} />
      )}

      {university !== null && (
        <SettingsGroup searchId="university.layout">
          {hiddenPresets.length > 0 && (
            <SettingsRow
              searchId="university.layout.hidden"
              badge={<Badge variant="default">{new Intl.NumberFormat(locale).format(hiddenPresets.length)}</Badge>}
              description={hiddenPresets.map((service) => serviceName(service, locale)).join(', ')}
              control={
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      for (const service of hiddenPresets) {
                        await setServiceHidden(service.id, false)
                      }
                    })
                  }
                >
                  {t('settings.university.restoreAll')}
                </Button>
              }
            />
          )}
          <SettingsRow
            searchId="university.layout.reset"
            control={
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(() => resetServiceLayout())}>
                {t('settings.university.resetLayout')}
              </Button>
            }
          />
        </SettingsGroup>
      )}

      <SavedLoginsSettings searchId="university.savedLogins" />
    </SettingsStack>
  )
}
