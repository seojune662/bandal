/**
 * [M8] 학교 고르기 — a searchable preset list plus a 직접 추가 escape hatch.
 *
 * Shared by onboarding step ② and 설정 > University, so it owns no copy about
 * *why* the student is picking a school; the container supplies that (앱 본체
 * 해요체 vs 설정 창 합니다체 — docs/STYLEGUIDE.md §7).
 *
 * 직접 추가 asks for the name and nothing else. Demanding six URLs up front is
 * how you lose people in onboarding (docs/university-sites.md §6.3); the one
 * optional field is a course URL, because a single paste is enough to infer
 * Canvas vs Moodle and switch deep links on for free.
 */

import { useId, useMemo, useState } from 'react'
import { searchUniversities } from '../../../../shared/universities'
import type { CustomUniversityInput } from '../../../../shared/types/university'
import { verifiedAtLabel } from './serviceCopy'
import './university.css'

interface UniversityPickerProps {
  selectedId: string | null
  /** Name of the current custom school, when one is selected. */
  customName?: string | undefined
  onSelectPreset: (universityId: string) => void
  onAddCustom: (input: CustomUniversityInput) => void
  /** Disables every control while a write is in flight. */
  busy?: boolean
}

export function UniversityPicker({
  selectedId,
  customName,
  onSelectPreset,
  onAddCustom,
  busy = false
}: UniversityPickerProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [customOpen, setCustomOpen] = useState(false)
  const [customNameDraft, setCustomNameDraft] = useState('')
  const [customUrl, setCustomUrl] = useState('')
  const searchId = useId()
  const nameId = useId()
  const urlId = useId()

  const results = useMemo(() => searchUniversities(query), [query])
  const trimmedQuery = query.trim()
  const customSelected =
    selectedId !== null && customName !== undefined && customName.length > 0

  const openCustomForm = (): void => {
    setCustomNameDraft(trimmedQuery)
    setCustomOpen(true)
  }

  const submitCustom = (event: React.FormEvent): void => {
    event.preventDefault()
    const nameKo = customNameDraft.trim()
    if (nameKo.length === 0) return
    const courseUrl = customUrl.trim()
    onAddCustom(courseUrl.length > 0 ? { nameKo, courseUrl } : { nameKo })
    setCustomOpen(false)
    setCustomUrl('')
    setQuery('')
  }

  return (
    <div className="university-picker">
      <label className="sr-only" htmlFor={searchId}>
        학교 검색
      </label>
      <input
        id={searchId}
        type="search"
        className="university-field university-picker__search"
        placeholder="학교 이름으로 찾기"
        value={query}
        autoComplete="off"
        disabled={busy}
        onChange={(event) => setQuery(event.target.value)}
      />

      {customSelected && (
        <p className="university-picker__current">
          지금 선택된 학교: <strong>{customName}</strong> (직접 추가)
        </p>
      )}

      <ul className="university-list" role="listbox" aria-label="학교 목록">
        {results.map((university) => {
          const selected = university.id === selectedId
          return (
            <li key={university.id}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                className="university-option"
                data-selected={selected}
                disabled={busy}
                onClick={() => onSelectPreset(university.id)}
              >
                <span className="university-option__name">{university.nameKo}</span>
                <span className="university-option__meta">
                  {university.domain} · {verifiedAtLabel(university.verifiedAt)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {results.length === 0 && (
        <p className="university-picker__zero">
          목록에 없는 학교예요. 직접 추가하면 바로가기를 하나씩 붙일 수 있어요.
        </p>
      )}

      {!customOpen ? (
        <button
          type="button"
          className="university-picker__custom-cta"
          disabled={busy}
          onClick={openCustomForm}
        >
          {trimmedQuery.length > 0
            ? `'${trimmedQuery}' 직접 추가`
            : '목록에 없는 학교 직접 추가'}
        </button>
      ) : (
        <form className="university-custom-form" onSubmit={submitCustom}>
          <label className="university-label" htmlFor={nameId}>
            학교 이름
          </label>
          <input
            id={nameId}
            className="university-field"
            value={customNameDraft}
            placeholder="학교 이름 입력"
            autoComplete="off"
            disabled={busy}
            onChange={(event) => setCustomNameDraft(event.target.value)}
          />
          <label className="university-label" htmlFor={urlId}>
            강의실 주소 <span className="university-custom-form__optional">(선택)</span>
          </label>
          <input
            id={urlId}
            className="university-field"
            value={customUrl}
            placeholder="LMS에서 과목을 연 주소를 붙여넣어 주세요"
            autoComplete="off"
            disabled={busy}
            onChange={(event) => setCustomUrl(event.target.value)}
          />
          <p className="university-custom-form__hint">
            주소를 넣어두면 과목마다 강의실 링크를 바로 붙일 수 있어요. 나중에
            넣어도 괜찮아요.
          </p>
          <div className="university-custom-form__actions">
            <button
              type="button"
              className="university-button"
              disabled={busy}
              onClick={() => setCustomOpen(false)}
            >
              취소
            </button>
            <button
              type="submit"
              className="university-button university-button--primary"
              disabled={busy || customNameDraft.trim().length === 0}
            >
              추가
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
