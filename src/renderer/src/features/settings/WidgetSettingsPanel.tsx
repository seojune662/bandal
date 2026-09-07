import { useEffect, useMemo, useState } from 'react'
import { WIDGET_IDS, type Settings, type WidgetId } from '../../../../shared/types/settings'
import { useLocale } from '../../i18n'
import { useUniversityStore } from '../../stores/universityStore'
import { SettingsCard, ToggleRow } from './primitives'
import { savePreference } from './savePreference'

const LABELS: Record<WidgetId, { ko: string; en: string }> = {
  todo: { ko: '투두', en: 'To-do' },
  board: { ko: '학업 보드', en: 'Study board' },
  mail: { ko: '웹메일', en: 'Webmail' }
}

export function WidgetSettingsPanel({ settings }: { settings: Settings | null }): JSX.Element {
  const locale = useLocale()
  const ko = locale === 'ko-KR'
  const services = useUniversityStore((state) => state.services)
  const initUniversity = useUniversityStore((state) => state.init)
  const widgets = settings?.widgets
  const [mailUrl, setMailUrl] = useState(widgets?.mailUrl ?? '')

  useEffect(() => void initUniversity(), [initUniversity])
  useEffect(() => setMailUrl(widgets?.mailUrl ?? ''), [widgets?.mailUrl])

  const mailServices = useMemo(
    () => services.filter((service) => service.kind === 'mail'),
    [services]
  )
  const ordered = widgets?.enabled ?? []

  const toggle = (id: WidgetId, enabled: boolean): void => {
    if (widgets === undefined) return
    const next = enabled
      ? [...ordered, id]
      : ordered.filter((candidate) => candidate !== id)
    void savePreference({
      widgets: {
        enabled: next,
        active: next.includes(widgets.active) ? widgets.active : (next[0] ?? 'todo')
      }
    })
  }

  const move = (id: WidgetId, delta: -1 | 1): void => {
    if (widgets === undefined) return
    const index = ordered.indexOf(id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= ordered.length) return
    const next = [...ordered]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    void savePreference({ widgets: { enabled: next } })
  }

  return (
    <div className="settings-stack">
      <SettingsCard
        title={ko ? '우측 사이드바 위젯' : 'Right sidebar widgets'}
        description={
          ko
            ? '사용할 위젯과 탭 순서를 선택합니다. 모두 끄면 위젯 영역이 숨겨집니다.'
            : 'Choose widgets and their tab order. The dock is hidden when all are off.'
        }
      >
        <div className="settings-card__rows">
          {WIDGET_IDS.map((id) => {
            const enabled = ordered.includes(id)
            const position = ordered.indexOf(id)
            return (
              <div key={id} className="widget-setting-row">
                <ToggleRow
                  label={LABELS[id][ko ? 'ko' : 'en']}
                  description={
                    id === 'mail'
                      ? ko ? '메일 내용을 읽지 않고 웹메일을 빠르게 엽니다.' : 'Quickly opens webmail without reading your mailbox.'
                      : ko ? '기존 학업 보드 태스크를 사용합니다.' : 'Uses your existing study-board tasks.'
                  }
                  checked={enabled}
                  disabled={widgets === undefined}
                  onChange={(next) => toggle(id, next)}
                />
                {enabled && ordered.length > 1 && (
                  <div className="widget-setting-row__order" aria-label={ko ? '탭 순서' : 'Tab order'}>
                    <button type="button" className="secondary-button" disabled={position === 0} onClick={() => move(id, -1)}>↑</button>
                    <button type="button" className="secondary-button" disabled={position === ordered.length - 1} onClick={() => move(id, 1)}>↓</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </SettingsCard>

      <SettingsCard
        title={ko ? '웹메일 연결' : 'Webmail shortcut'}
        description={ko ? '학교 프리셋을 고르거나 직접 주소를 입력하세요.' : 'Choose a school preset or enter a URL.'}
      >
        <div className="settings-card__rows">
          {mailServices.length > 0 && (
            <label className="setting-row">
              <span className="setting-row__copy">
                <span className="setting-row__label">{ko ? '학교 메일' : 'School mail'}</span>
              </span>
              <select
                className="language-select"
                value={widgets?.mailServiceId ?? ''}
                disabled={widgets === undefined}
                onChange={(event) => void savePreference({ widgets: { mailServiceId: event.target.value || null } })}
              >
                <option value="">{ko ? '첫 번째 메일 서비스' : 'First mail service'}</option>
                {mailServices.map((service) => <option key={service.id} value={service.id}>{service.label}</option>)}
              </select>
            </label>
          )}
          <label className="setting-row">
            <span className="setting-row__copy">
              <span className="setting-row__label">{ko ? '직접 입력 URL' : 'Custom URL'}</span>
              <span className="setting-row__description">{ko ? '학교 메일이 없을 때 사용합니다.' : 'Used when no school mail shortcut is available.'}</span>
            </span>
            <input
              className="settings-text-input widget-mail-url"
              type="url"
              placeholder="https://mail.example.edu"
              value={mailUrl}
              disabled={widgets === undefined}
              onChange={(event) => setMailUrl(event.target.value)}
              onBlur={() => {
                if (mailUrl !== widgets?.mailUrl) void savePreference({ widgets: { mailUrl } })
              }}
            />
          </label>
        </div>
      </SettingsCard>
    </div>
  )
}
