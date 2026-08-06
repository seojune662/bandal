import { useEffect, useState } from 'react'
import type {
  ExternalReason,
  ServiceKind,
  University,
  UniversityService,
  VerificationLevel
} from '../../../../shared/types/university'
import { useLocale, useT } from '../../i18n'
import { useUniversityStore } from '../../stores/universityStore'
import { SettingsUniversityPicker } from './SettingsUniversityPicker'
import '../university/university.css'

type Translator = ReturnType<typeof useT>
type CurrentLocale = ReturnType<typeof useLocale>

function universityName(university: University, locale: CurrentLocale): string {
  return locale === 'en-US' && university.nameEn.length > 0
    ? university.nameEn
    : university.nameKo
}

function serviceName(service: UniversityService, locale: CurrentLocale): string {
  return locale === 'en-US' && service.labelEn !== undefined
    ? service.labelEn
    : service.label
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

function externalReasonMessage(
  t: Translator,
  reason: ExternalReason | undefined
): string {
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
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void init()
  }, [init])

  const run = (work: () => Promise<void>): void => {
    setBusy(true)
    void work().finally(() => setBusy(false))
  }

  const hiddenIds = settings.hiddenServiceIds
  const hiddenPresets = (university?.services ?? []).filter((service) =>
    hiddenIds.includes(service.id)
  )

  return (
    <div className="settings-stack">
      <section className="settings-card">
        <div className="settings-card__header">
          <h2>{t('settings.university.mine.title')}</h2>
          <p>
            {university === null
              ? t('settings.university.mine.emptyHelp')
              : t('settings.university.mine.selected', {
                  name: universityName(university, locale),
                  verifiedAt: verifiedAtLabel(t, university.verifiedAt)
                })}
          </p>
        </div>
        {!loaded ? (
          <p className="settings-feedback">{t('settings.university.loading')}</p>
        ) : (
          <SettingsUniversityPicker
            selectedId={settings.universityId}
            customName={settings.customUniversity?.nameKo}
            busy={busy}
            onSelectPreset={(id) => run(() => selectPreset(id))}
            onAddCustom={(input) => run(() => addCustom(input))}
          />
        )}
        {university !== null && (
          <div className="settings-card__footer-row">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => run(() => clearSelection())}
            >
              {t('settings.university.clear')}
            </button>
          </div>
        )}
        <p
          className={`settings-feedback${error !== null ? ' settings-feedback--error' : ''}`}
          aria-live="polite"
        >
          {error !== null
            ? t('settings.university.saveError')
            : t('settings.university.catalogHelp')}
        </p>
      </section>

      {university !== null && (
        <section className="settings-card">
          <div className="settings-card__header">
            <h2>{t('settings.university.shortcuts.title')}</h2>
            <p>{t('settings.university.shortcuts.description')}</p>
          </div>

          <div className="university-service-table">
            {services.map((service) => {
              const badge = verificationBadge(t, service.verification)
              const label = serviceName(service, locale)
              return (
                <div className="setting-row" key={service.id}>
                  <div className="setting-row__copy">
                    <div className="setting-row__label-line">
                      <span className="setting-row__label">{label}</span>
                      <span className="badge">
                        {serviceKindLabel(t, service.kind)}
                      </span>
                      {badge !== null && <span className="badge">{badge}</span>}
                    </div>
                    <span className="setting-row__description">
                      {service.opensExternally
                        ? externalReasonMessage(t, service.externalReason)
                        : locale === 'ko-KR'
                          ? (service.note ?? service.url)
                          : service.url}
                    </span>
                  </div>
                  <div className="university-service-table__actions">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={service.opensExternally}
                      aria-label={t('settings.university.openExternal', {
                        name: label
                      })}
                      className={`toggle${service.opensExternally ? ' toggle--checked' : ''}`}
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          setOpenExternally(service.id, !service.opensExternally)
                        )
                      }
                    >
                      <span className="toggle__thumb" />
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => run(() => setServiceHidden(service.id, true))}
                    >
                      {t('settings.university.hide')}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {hiddenPresets.length > 0 && (
            <div className="settings-card__footer-row">
              <div className="setting-row">
                <div className="setting-row__copy">
                  <div className="setting-row__label-line">
                    <span className="setting-row__label">
                      {t('settings.university.hidden')}
                    </span>
                    <span className="count-badge">
                      {new Intl.NumberFormat(locale).format(hiddenPresets.length)}
                    </span>
                  </div>
                  <span className="setting-row__description">
                    {hiddenPresets
                      .map((service) => serviceName(service, locale))
                      .join(', ')}
                  </span>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      for (const service of hiddenPresets) {
                        await setServiceHidden(service.id, false)
                      }
                    })
                  }
                >
                  {t('settings.university.restoreAll')}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
