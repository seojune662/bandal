/**
 * [M6-A] First-run onboarding — a 4-step overlay wizard.
 *
 * ① 반달 소개 (token-based graphic, no bitmap assets)
 * ② 학교 고르기 [M8] (프리셋 검색 + 직접 추가, universityStore가 저장)
 * ③ 첫 과목 만들기 (inline create, coursesStore를 그대로 재사용)
 * ④ AI 준비 상태 (useAgentPreflight의 라이브 프로브 + 재확인)
 *
 * Dismissible at any moment (X / Esc / 나중에) — dismissal persists
 * `closedAt` and the wizard never auto-reopens. Reopen deliberately via
 * 설정 > General > "온보딩 다시 보기".
 */

import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from '../../app/icons'
import { useCoursesStore } from '../../stores/coursesStore'
import { acquirePointerPassthrough } from '../browser/webviewPassthrough'
import {
  COURSE_COLORS,
  courseColorLabel,
  type CourseColor
} from '../courses/courseColors'
import { useUniversityStore } from '../../stores/universityStore'
import { UniversityPicker } from '../university/UniversityPicker'
import { ONBOARDING_STEP_COUNT, type OnboardingStep } from './onboardingModel'
import { useOnboardingStore } from './onboardingStore'
import { useAgentPreflight } from './useAgentPreflight'
import '../courses/courses.css'
import './onboarding.css'

const STEP_TITLES: readonly string[] = [
  '반달과 만나기',
  '학교 고르기',
  '첫 과목 만들기',
  'AI 튜터 준비'
]

// -- step ① 소개 --------------------------------------------------------------

function IntroStep(): JSX.Element {
  return (
    <div className="onboarding-step">
      <div className="onboarding-phases" aria-hidden="true">
        <span className="onboarding-phase onboarding-phase--new" />
        <span className="onboarding-phase onboarding-phase--half" />
        <span className="onboarding-phase onboarding-phase--full" />
      </div>
      <p className="onboarding-eyebrow">WELCOME</p>
      <h2 className="onboarding-title">반달에 오신 걸 환영해요</h2>
      <ul className="onboarding-points">
        <li>
          <span className="onboarding-point__mark" aria-hidden="true" />
          과목마다 자료·필기·브라우저가 하나의 작업 공간으로 모여요.
        </li>
        <li>
          <span className="onboarding-point__mark" aria-hidden="true" />
          AI 튜터가 과목 자료를 읽고 요약과 필기를 도와줘요.
        </li>
        <li>
          <span className="onboarding-point__mark" aria-hidden="true" />
          달이 차오르듯, 학기의 공부가 조금씩 쌓여요.
        </li>
      </ul>
    </div>
  )
}

// -- step ② 학교 고르기 --------------------------------------------------------

function SchoolStep(): JSX.Element {
  const university = useUniversityStore((state) => state.university)
  const settings = useUniversityStore((state) => state.settings)
  const error = useUniversityStore((state) => state.error)
  const selectPreset = useUniversityStore((state) => state.selectPreset)
  const addCustom = useUniversityStore((state) => state.addCustom)
  const init = useUniversityStore((state) => state.init)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void init()
  }, [init])

  const run = (work: () => Promise<void>): void => {
    setBusy(true)
    void work().finally(() => setBusy(false))
  }

  return (
    <div className="onboarding-step">
      <p className="onboarding-eyebrow">CAMPUS</p>
      <h2 className="onboarding-title">어느 학교에 다니고 있나요?</h2>
      <p className="onboarding-desc">
        학교를 고르면 학사 포털·강의실·도서관 바로가기가 왼쪽에 떠요. 로그인은
        앱 안 브라우저에서 그대로 유지되고, 비밀번호는 저장하지 않아요.
      </p>
      <UniversityPicker
        selectedId={settings.universityId}
        customName={settings.customUniversity?.nameKo}
        busy={busy}
        onSelectPreset={(id) => run(() => selectPreset(id))}
        onAddCustom={(input) => run(() => addCustom(input))}
      />
      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {university !== null && error === null && (
        <p className="onboarding-ai-later">
          나중에 설정에서 언제든 학교를 바꿀 수 있어요.
        </p>
      )}
    </div>
  )
}

// -- step ③ 첫 과목 -----------------------------------------------------------

function CourseStep(): JSX.Element {
  const courses = useCoursesStore((state) => state.courses)
  const createCourse = useCoursesStore((state) => state.createCourse)
  const [name, setName] = useState('')
  const [color, setColor] = useState<CourseColor>('gold')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()

  useEffect(() => {
    if (courses.length === 0) inputRef.current?.focus()
  }, [courses.length])

  if (courses.length > 0) {
    const first = courses[0]
    return (
      <div className="onboarding-step">
        <p className="onboarding-eyebrow">COURSE</p>
        <h2 className="onboarding-title">과목이 준비됐어요</h2>
        <p className="onboarding-desc">
          {courses.length === 1 && first !== undefined
            ? `"${first.name}" 과목이 만들어졌어요. 왼쪽 목록에서 언제든 과목을 더 추가할 수 있어요.`
            : `${courses.length}개의 과목이 등록되어 있어요. 왼쪽 목록에서 언제든 더 추가할 수 있어요.`}
        </p>
      </div>
    )
  }

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    const normalized = name.trim()
    if (normalized.length === 0) {
      setError('과목 이름을 입력해주세요.')
      inputRef.current?.focus()
      return
    }
    setPending(true)
    setError(null)
    try {
      await createCourse({ name: normalized, color })
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : '과목을 만들지 못했습니다.'
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="onboarding-step">
      <p className="onboarding-eyebrow">COURSE</p>
      <h2 className="onboarding-title">첫 과목을 만들어볼까요?</h2>
      <p className="onboarding-desc">
        과목 하나가 곧 작업 공간 하나예요. 이번 학기 수업 하나로 시작해보세요.
      </p>
      <form className="onboarding-course-form" onSubmit={(event) => void submit(event)}>
        <label className="field-label" htmlFor={inputId}>
          이름
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className="text-field"
          value={name}
          placeholder="예: 자료구조"
          autoComplete="off"
          disabled={pending}
          aria-invalid={error !== null}
          onChange={(event) => setName(event.target.value)}
        />
        <fieldset className="color-fieldset">
          <legend className="field-label">색상</legend>
          <div className="color-palette">
            {COURSE_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                className="color-swatch"
                data-course-color={option}
                data-selected={color === option}
                aria-label={courseColorLabel(option)}
                aria-pressed={color === option}
                disabled={pending}
                onClick={() => setColor(option)}
              >
                <span className="color-swatch__fill" />
              </button>
            ))}
          </div>
        </fieldset>
        {error !== null && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="button button--primary onboarding-course-form__submit"
          disabled={pending}
        >
          {pending ? '만드는 중…' : '과목 만들기'}
        </button>
      </form>
    </div>
  )
}

// -- step ④ AI 준비 -----------------------------------------------------------

function AiStatusRow({
  label,
  ok,
  detail
}: {
  label: string
  ok: boolean | null
  detail: string
}): JSX.Element {
  return (
    <div className="onboarding-ai-row" data-ok={ok === null ? undefined : ok}>
      <span className="onboarding-ai-row__dot" aria-hidden="true" />
      <span className="onboarding-ai-row__label">{label}</span>
      <span className="onboarding-ai-row__detail">{detail}</span>
    </div>
  )
}

function AiStep(): JSX.Element {
  const status = useAgentPreflight((state) => state.status)
  const availability = useAgentPreflight((state) => state.availability)
  const probe = useAgentPreflight((state) => state.probe)

  useEffect(() => {
    if (status === 'idle') void probe()
  }, [status, probe])

  const checking = status === 'checking' || status === 'idle'
  const installed = availability?.installed === true
  const loggedIn = availability?.loggedIn === true
  const ready = installed && loggedIn

  return (
    <div className="onboarding-step">
      <p className="onboarding-eyebrow">AI TUTOR</p>
      <h2 className="onboarding-title">
        {ready ? 'AI 튜터가 준비됐어요' : 'AI 튜터를 연결해요'}
      </h2>
      <p className="onboarding-desc">
        AI 튜터는 내 컴퓨터의 Claude Code CLI로 동작해요. 지금 설치와 로그인
        상태를 확인해볼게요.
      </p>

      <div className="onboarding-ai-card" aria-busy={checking}>
        {checking ? (
          <div className="onboarding-ai-checking" role="status">
            <span className="onboarding-ai-checking__moon" aria-hidden="true" />
            연결 상태를 확인하는 중…
          </div>
        ) : status === 'error' ? (
          <p className="onboarding-ai-error">
            상태를 확인하지 못했어요. 잠시 후 재확인을 눌러주세요.
          </p>
        ) : (
          <>
            <AiStatusRow
              label="설치"
              ok={installed}
              detail={
                installed
                  ? `Claude Code ${availability?.version ?? ''}`.trim()
                  : '설치되지 않았어요'
              }
            />
            <AiStatusRow
              label="로그인"
              ok={installed ? loggedIn : null}
              detail={
                !installed ? '—' : loggedIn ? '연결됐어요' : '로그인이 필요해요'
              }
            />
            {!ready && (
              <p className="onboarding-ai-hint">
                터미널에서{' '}
                <code className="onboarding-inline-code">claude</code>를 실행해
                {installed ? ' 로그인한' : ' 설치와 로그인을 마친'} 뒤 재확인을
                눌러주세요.
              </p>
            )}
          </>
        )}
        <button
          type="button"
          className="button button--secondary onboarding-ai-refresh"
          disabled={checking}
          onClick={() => void probe()}
        >
          <Icon name="refresh" />
          재확인
        </button>
      </div>
      {!ready && (
        <p className="onboarding-ai-later">
          지금 준비되지 않아도 괜찮아요 — 나중에 채팅 탭에서 이어서 연결할 수
          있어요.
        </p>
      )}
    </div>
  )
}

// -- overlay ------------------------------------------------------------------

export function OnboardingOverlay(): JSX.Element {
  const step = useOnboardingStore((state) => state.step)
  const setStep = useOnboardingStore((state) => state.setStep)
  const completeAndAdvance = useOnboardingStore(
    (state) => state.completeAndAdvance
  )
  const dismiss = useOnboardingStore((state) => state.dismiss)
  const titleId = useId()

  // Webview guests must not eat the pointer while the overlay is up.
  useEffect(() => acquirePointerPassthrough(), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // An inner surface (e.g. ⌘P overlay) that consumed this Escape wins.
      if (event.key === 'Escape' && !event.defaultPrevented) dismiss()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dismiss])

  const isLast = step === ONBOARDING_STEP_COUNT - 1

  return (
    <div className="onboarding-overlay" role="presentation">
      <div
        className="onboarding-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="onboarding-header">
          <div className="onboarding-progress" aria-label="온보딩 진행 단계">
            {STEP_TITLES.map((title, index) => (
              <button
                key={title}
                type="button"
                className="onboarding-progress__dot"
                data-active={index === step}
                data-done={index < step}
                aria-label={`${index + 1}단계: ${title}`}
                aria-current={index === step ? 'step' : undefined}
                onClick={() => setStep(index as OnboardingStep)}
              />
            ))}
          </div>
          <span id={titleId} className="sr-only">
            {STEP_TITLES[step]}
          </span>
          <button
            type="button"
            className="bare-icon-button"
            aria-label="온보딩 닫기"
            onClick={dismiss}
          >
            <Icon name="x" />
          </button>
        </header>

        <div className="onboarding-body" key={step}>
          {step === 0 ? (
            <IntroStep />
          ) : step === 1 ? (
            <SchoolStep />
          ) : step === 2 ? (
            <CourseStep />
          ) : (
            <AiStep />
          )}
        </div>

        <footer className="onboarding-footer">
          <button
            type="button"
            className="onboarding-footer__skip"
            onClick={dismiss}
          >
            나중에 볼게요
          </button>
          <div className="onboarding-footer__nav">
            {step > 0 && (
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setStep((step - 1) as OnboardingStep)}
              >
                이전
              </button>
            )}
            <button
              type="button"
              className="button button--primary"
              onClick={() => completeAndAdvance(step)}
            >
              {isLast ? '반달 시작하기' : '다음'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
