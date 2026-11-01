import { useEffect, useMemo, useState } from 'react'
import { WIDGET_IDS, type Settings, type WidgetId } from '../../../../shared/types/settings'
import { showToast } from '../../app/toast'
import { useLocale } from '../../i18n'
import { invoke } from '../../lib/ipc'
import { useUniversityStore } from '../../stores/universityStore'
import { SettingsCard, ToggleRow } from './primitives'
import { savePreference } from './savePreference'

const LABELS: Record<WidgetId, { ko: string; en: string }> = {
  todo: { ko: '투두', en: 'To-do' },
  board: { ko: '학업 보드', en: 'Study board' },
  mail: { ko: '메일함', en: 'Mailbox' }
}

export function WidgetSettingsPanel({ settings }: { settings: Settings | null }): JSX.Element {
  const locale = useLocale()
  const ko = locale === 'ko-KR'
  // The Gmail mailbox waits on Google's restricted-scope review (BANDAL_GMAIL_UI).
  const gmail = window.bandal?.gmailUi === true
  const services = useUniversityStore((state) => state.services)
  const initUniversity = useUniversityStore((state) => state.init)
  const widgets = settings?.widgets
  const [mailUrl, setMailUrl] = useState(widgets?.mailUrl ?? '')
  // The account of a saved Gmail sign-in, so it can be removed even while the mailbox is hidden.
  const [gmailAccount, setGmailAccount] = useState<string | null>(null)

  useEffect(() => void initUniversity(), [initUniversity])
  useEffect(() => void invoke('mail:state', {}).then((account) => setGmailAccount(account.email)).catch(() => {}), [])
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
                      ? gmail
                        ? ko ? '우측 위젯 안에서 메일을 읽고 관리합니다.' : 'Read and manage mail inside the right-side widget.'
                        : ko ? '우측 위젯에서 학교 메일이나 웹메일을 엽니다.' : 'Opens your school mail or webmail from the right-side widget.'
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
        title={ko ? '메일 위젯 연결' : 'Mail widget connection'}
        description={gmail
          ? ko ? 'Gmail은 메일 위젯에서 별도로 연결해 읽기·답장·보관할 수 있습니다. 아래 학교 메일은 전체 메일함 바로가기에 사용합니다.' : 'Connect Gmail separately in the widget to read, reply, and archive. School mail below is used for the full mailbox shortcut.'
          : ko ? '메일 위젯은 아래 학교 메일을 새 탭에서 엽니다.' : 'The mail widget opens the school mail below in a new tab.'}
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
          {gmailAccount !== null && (
            <div className="setting-row">
              <div className="setting-row__copy">
                <span className="setting-row__label">{ko ? 'Google 메일' : 'Google Mail'}</span>
                <span className="setting-row__description">{ko ? `${gmailAccount} 로그인이 이 기기에 저장되어 있습니다.` : `The sign-in for ${gmailAccount} is saved on this device.`}</span>
              </div>
              <button type="button" className="secondary-button settings-advanced-danger-button" onClick={() => {
                if (!window.confirm(ko ? '이 기기에서 Google 메일 연결을 해제할까요?' : 'Disconnect Google Mail on this device?')) return
                // Resolves only once the token file is gone.
                void invoke('mail:disconnect', {}).then(() => setGmailAccount(null))
                  .catch(() => showToast(ko ? '메일 연결을 해제하지 못했어요. 다시 시도해 주세요.' : 'Could not disconnect mail. Please try again.', 'danger'))
              }}>
                {ko ? 'Google 메일 연결 해제' : 'Disconnect Google Mail'}
              </button>
            </div>
          )}
        </div>
      </SettingsCard>
    </div>
  )
}
