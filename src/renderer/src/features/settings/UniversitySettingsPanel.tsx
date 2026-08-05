/**
 * [M8] 설정 > University.
 *
 * Two jobs: change the school, and tune its shortcut list. Tuning is a
 * user-owned layer over the preset (docs/university-sites.md §6.2) — hiding a
 * service or flipping its 외부 브라우저 decision writes into settings, never
 * into the catalog, so an app update that fixes a URL cannot clobber it.
 *
 * 설정 창 톤은 합니다체 (docs/STYLEGUIDE.md §7).
 */

import { useEffect, useState } from 'react'
import { serviceKindLabel } from '../../../../shared/universities'
import { useUniversityStore } from '../../stores/universityStore'
import {
  externalReasonMessage,
  verificationBadge,
  verifiedAtLabel
} from '../university/serviceCopy'
import { UniversityPicker } from '../university/UniversityPicker'
import '../university/university.css'

export function UniversitySettingsPanel(): JSX.Element {
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
          <h2>내 학교</h2>
          <p>
            {university === null
              ? '학교를 선택하면 학사 포털·강의실·도서관 바로가기가 왼쪽 사이드바에 표시됩니다.'
              : `${university.nameKo} · ${verifiedAtLabel(university.verifiedAt)}`}
          </p>
        </div>
        {!loaded ? (
          <p className="settings-feedback">불러오는 중입니다…</p>
        ) : (
          <UniversityPicker
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
              학교 선택 해제
            </button>
          </div>
        )}
        <p
          className={`settings-feedback${error !== null ? ' settings-feedback--error' : ''}`}
          aria-live="polite"
        >
          {error ??
            '주소는 앱과 함께 배포되며, 학교가 주소를 바꾸면 업데이트로 반영됩니다.'}
        </p>
      </section>

      {university !== null && (
        <section className="settings-card">
          <div className="settings-card__header">
            <h2>바로가기</h2>
            <p>
              앱 안 브라우저에서 열지, 기본 브라우저로 넘길지 서비스마다 정할 수
              있습니다. 비밀번호는 저장하지 않습니다.
            </p>
          </div>

          <div className="university-service-table">
            {services.map((service) => {
              const badge = verificationBadge(service.verification)
              return (
                <div className="setting-row" key={service.id}>
                  <div className="setting-row__copy">
                    <div className="setting-row__label-line">
                      <span className="setting-row__label">{service.label}</span>
                      <span className="badge">{serviceKindLabel(service.kind)}</span>
                      {badge !== null && <span className="badge">{badge}</span>}
                    </div>
                    <span className="setting-row__description">
                      {service.opensExternally
                        ? externalReasonMessage(service.externalReason)
                        : (service.note ?? service.url)}
                    </span>
                  </div>
                  <div className="university-service-table__actions">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={service.opensExternally}
                      aria-label={`${service.label} 기본 브라우저로 열기`}
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
                      숨기기
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
                    <span className="setting-row__label">숨긴 바로가기</span>
                    <span className="count-badge">{hiddenPresets.length}</span>
                  </div>
                  <span className="setting-row__description">
                    {hiddenPresets.map((service) => service.label).join(', ')}
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
                  모두 되돌리기
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
