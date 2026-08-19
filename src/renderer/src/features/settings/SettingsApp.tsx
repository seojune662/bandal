import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { showToast, ToastHost } from '../../app/toast'
import { BandalMark } from '../../components/BandalMark'
import { useLocale, useT } from '../../i18n'
import { invoke, onPush } from '../../lib/ipc'
import type {
  AgentAvailability,
  AgentProvider
} from '../../../../shared/types/agent-events'
import type { Course } from '../../../../shared/types/course'
import type { PaletteId } from '../../../../shared/theme'
import type {
  Settings,
  ThemePreference
} from '../../../../shared/types/settings'
import { AccountPanel } from './AccountPanel'
import { AgentAccessPanel } from './AgentAccessPanel'
import { BrowsingDataPanel } from './BrowsingDataPanel'
import {
  AboutPanel,
  AiPanel,
  AppearancePanel,
  CoursesPanel,
  GeneralPanel
} from './SettingsPanels'
import { Icon } from './SettingsIcon'
import { applyTheme } from './settingsTheme'
import { UniversitySettingsPanel } from './UniversitySettingsPanel'
import './settings-app.css'
import './settings-panels.css'

type CategoryId =
  | 'account'
  | 'general'
  | 'appearance'
  | 'ai'
  | 'university'
  | 'courses'
  | 'about'

type CategoryGroup = 'settings' | 'workspace' | 'info'

interface Category {
  id: CategoryId
  group: CategoryGroup
  label: string
  description: string
  keywords: string
}

interface SettingsAppProps {
  embedded?: boolean
  onClose?: () => void
}

const AGENT_PROVIDERS: readonly AgentProvider[] = ['claude-code', 'codex']

type ProviderState<T> = Record<AgentProvider, T>

export function SettingsApp({
  embedded = false,
  onClose
}: SettingsAppProps = {}): JSX.Element {
  const t = useT()
  const locale = useLocale()
  const [activeCategory, setActiveCategory] = useState<CategoryId>('general')
  const [query, setQuery] = useState('')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [theme, setTheme] = useState<ThemePreference>('dark')
  const [palette, setPalette] = useState<PaletteId>('bandal')
  const [themeSaving, setThemeSaving] = useState(false)
  const [themeErrorKey, setThemeErrorKey] = useState<string | null>(null)
  const [availability, setAvailability] = useState<
    ProviderState<AgentAvailability | null>
  >({ 'claude-code': null, codex: null })
  const [availabilityLoading, setAvailabilityLoading] = useState<
    ProviderState<boolean>
  >({ 'claude-code': true, codex: true })
  const [availabilityError, setAvailabilityError] = useState<
    ProviderState<string | null>
  >({ 'claude-code': null, codex: null })
  const [agentProviderSaving, setAgentProviderSaving] = useState(false)
  const [agentProviderFeedbackKey, setAgentProviderFeedbackKey] = useState<
    string | null
  >(null)
  const [courses, setCourses] = useState<Course[]>([])
  const [coursesLoading, setCoursesLoading] = useState(true)
  const [coursesError, setCoursesError] = useState<string | null>(null)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [pendingCourseId, setPendingCourseId] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const categories = useMemo<readonly Category[]>(
    () => [
      {
        id: 'account',
        group: 'settings',
        label: t('settings.category.account.label'),
        description: t('settings.category.account.description'),
        keywords: t('settings.category.account.keywords')
      },
      {
        id: 'general',
        group: 'settings',
        label: t('settings.category.general.label'),
        description: t('settings.category.general.description'),
        keywords: t('settings.category.general.keywords')
      },
      {
        id: 'appearance',
        group: 'settings',
        label: t('settings.category.appearance.label'),
        description: t('settings.category.appearance.description'),
        keywords: t('settings.category.appearance.keywords')
      },
      {
        id: 'ai',
        group: 'workspace',
        label: t('settings.category.ai.label'),
        description: t('settings.category.ai.description'),
        keywords: t('settings.category.ai.keywords')
      },
      {
        id: 'university',
        group: 'workspace',
        label: t('settings.category.university.label'),
        description: t('settings.category.university.description'),
        keywords: t('settings.category.university.keywords')
      },
      {
        id: 'courses',
        group: 'workspace',
        label: t('settings.category.courses.label'),
        description: t('settings.category.courses.description'),
        keywords: t('settings.category.courses.keywords')
      },
      {
        id: 'about',
        group: 'info',
        label: t('settings.category.about.label'),
        description: t('settings.category.about.description'),
        keywords: t('settings.category.about.keywords')
      }
    ],
    [t]
  )

  const active =
    categories.find((category) => category.id === activeCategory) ?? categories[0]!

  const filteredCategories = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (normalized.length === 0) return categories
    return categories.filter((category) =>
      `${category.label} ${category.description} ${category.keywords}`
        .toLocaleLowerCase()
        .includes(normalized)
    )
  }, [categories, query])

  const loadAvailability = useCallback((target?: AgentProvider): void => {
    const providers = target === undefined ? AGENT_PROVIDERS : [target]

    for (const provider of providers) {
      setAvailabilityLoading((current) => ({ ...current, [provider]: true }))
      setAvailabilityError((current) => ({ ...current, [provider]: null }))
      void invoke('agent:availability', { provider })
        .then((result) => {
          if (mountedRef.current) {
            setAvailability((current) => ({ ...current, [provider]: result }))
          }
        })
        .catch(() => {
          if (mountedRef.current) {
            setAvailabilityError((current) => ({
              ...current,
              [provider]: 'availability-failed'
            }))
          }
        })
        .finally(() => {
          if (mountedRef.current) {
            setAvailabilityLoading((current) => ({
              ...current,
              [provider]: false
            }))
          }
        })
    }
  }, [])

  const loadCourses = (showArchived: boolean): void => {
    setCoursesLoading(true)
    setCoursesError(null)
    void invoke('courses:list', { includeArchived: showArchived })
      .then((result) => {
        if (mountedRef.current) setCourses(result)
      })
      .catch(() => {
        if (mountedRef.current) setCoursesError('courses-failed')
      })
      .finally(() => {
        if (mountedRef.current) setCoursesLoading(false)
      })
  }

  useEffect(() => {
    mountedRef.current = true
    const unsubscribe = onPush('settings:changed', ({ settings: next }) => {
      setSettings(next)
      setTheme(next.theme)
      setPalette(next.palette)
      if (!embedded) applyTheme(next.theme, next.palette)
    })

    void invoke('settings:get', {})
      .then((result) => {
        if (!mountedRef.current) return
        setSettings(result)
        setTheme(result.theme)
        setPalette(result.palette)
        if (!embedded) applyTheme(result.theme, result.palette)
      })
      .catch(() => {
        if (mountedRef.current) {
          setThemeErrorKey('settings.appearance.loadFailed')
        }
      })

    loadAvailability()
    loadCourses(false)

    return () => {
      mountedRef.current = false
      unsubscribe()
    }
  }, [embedded, loadAvailability])

  useEffect(() => {
    const refreshAvailability = (): void => loadAvailability()
    const refreshWhenVisible = (): void => {
      if (document.visibilityState === 'visible') refreshAvailability()
    }
    const unsubscribe = onPush('agent:install-progress', (progress) => {
      if (
        progress.done &&
        (progress.provider === 'claude-code' || progress.provider === 'codex')
      ) {
        loadAvailability(progress.provider)
      }
    })
    window.addEventListener('focus', refreshAvailability)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', refreshAvailability)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [loadAvailability])

  useEffect(() => {
    if (embedded) return
    document.documentElement.lang = locale
    document.title = `${t('settings.app.name')} — ${t('settings.window.title')}`
  }, [embedded, locale, t])

  useEffect(() => {
    if (embedded) return
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const handleChange = (): void => {
      if (theme === 'system') applyTheme('system', palette)
    }
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [embedded, palette, theme])

  /**
   * Both appearance axes save the same way: paint optimistically, persist,
   * then reconcile with whatever main actually stored (and roll the pair back
   * together on failure — a half-applied appearance is worse than neither).
   */
  const saveAppearance = (
    next: { theme: ThemePreference; palette: PaletteId }
  ): void => {
    if (themeSaving) return
    const previous = { theme, palette }
    if (next.theme === previous.theme && next.palette === previous.palette) {
      return
    }
    setTheme(next.theme)
    setPalette(next.palette)
    if (!embedded) applyTheme(next.theme, next.palette)
    setThemeSaving(true)
    setThemeErrorKey(null)

    void invoke('settings:set', next)
      .then((nextSettings) => {
        if (!mountedRef.current) return
        setSettings(nextSettings)
        setTheme(nextSettings.theme)
        setPalette(nextSettings.palette)
        if (!embedded) applyTheme(nextSettings.theme, nextSettings.palette)
      })
      .catch(() => {
        if (!mountedRef.current) return
        setTheme(previous.theme)
        setPalette(previous.palette)
        if (!embedded) applyTheme(previous.theme, previous.palette)
        setThemeErrorKey('settings.appearance.saveFailed')
      })
      .finally(() => {
        if (mountedRef.current) setThemeSaving(false)
      })
  }

  const handleThemeSelect = (nextTheme: ThemePreference): void => {
    saveAppearance({ theme: nextTheme, palette })
  }

  const handlePaletteSelect = (nextPalette: PaletteId): void => {
    saveAppearance({ theme, palette: nextPalette })
  }

  const handleAgentProviderSelect = (nextProvider: AgentProvider): void => {
    if (
      settings === null ||
      nextProvider === settings.agentProvider ||
      agentProviderSaving
    ) {
      return
    }

    const previousProvider = settings.agentProvider
    setSettings((current) =>
      current === null ? current : { ...current, agentProvider: nextProvider }
    )
    setAgentProviderSaving(true)
    setAgentProviderFeedbackKey('settings.ai.engine.saving')

    void invoke('settings:set', { agentProvider: nextProvider })
      .then((nextSettings) => {
        if (!mountedRef.current) return
        setSettings(nextSettings)
        setAgentProviderFeedbackKey('settings.ai.engine.saved')
      })
      .catch(() => {
        if (!mountedRef.current) return
        setSettings((current) =>
          current === null
            ? current
            : { ...current, agentProvider: previousProvider }
        )
        setAgentProviderFeedbackKey('settings.ai.engine.saveFailed')
      })
      .finally(() => {
        if (mountedRef.current) setAgentProviderSaving(false)
      })
  }

  const handleArchivedChange = (next: boolean): void => {
    setIncludeArchived(next)
    loadCourses(next)
  }

  const handleRestoreCourse = async (course: Course): Promise<void> => {
    if (pendingCourseId !== null) return
    setPendingCourseId(course.id)
    try {
      const restored = await invoke('courses:archive', {
        courseId: course.id,
        archived: false
      })
      if (!mountedRef.current) return
      setCourses((current) =>
        current.map((item) => (item.id === restored.id ? restored : item))
      )
      showToast(
        locale === 'ko-KR'
          ? `“${course.name}” 과목을 복원했어요.`
          : `Restored “${course.name}”.`
      )
    } catch {
      if (mountedRef.current) {
        showToast(
          locale === 'ko-KR'
            ? '과목을 복원하지 못했어요.'
            : 'Could not restore the course.',
          'danger'
        )
      }
    } finally {
      if (mountedRef.current) setPendingCourseId(null)
    }
  }

  const panel = {
    account: <AccountPanel />,
    general: (
      <>
        <GeneralPanel settings={settings} />
        <BrowsingDataPanel settings={settings} />
      </>
    ),
    appearance: (
      <AppearancePanel
        theme={theme}
        palette={palette}
        saving={themeSaving}
        error={themeErrorKey === null ? null : t(themeErrorKey)}
        onSelect={handleThemeSelect}
        onSelectPalette={handlePaletteSelect}
      />
    ),
    ai: (
      <>
      <AiPanel
        provider={settings?.agentProvider ?? 'claude-code'}
        providerReady={settings !== null}
        providerSaving={agentProviderSaving}
        providerFeedback={
          agentProviderFeedbackKey === null ? null : t(agentProviderFeedbackKey)
        }
        providerFeedbackError={
          agentProviderFeedbackKey === 'settings.ai.engine.saveFailed'
        }
        availability={availability}
        loading={availabilityLoading}
        error={availabilityError}
        onProviderSelect={handleAgentProviderSelect}
        onRetry={loadAvailability}
      />
      <AgentAccessPanel />
      </>
    ),
    university: <UniversitySettingsPanel />,
    courses: (
      <CoursesPanel
        courses={courses}
        loading={coursesLoading}
        error={coursesError}
        includeArchived={includeArchived}
        pendingCourseId={pendingCourseId}
        onIncludeArchivedChange={handleArchivedChange}
        onRestore={(course) => void handleRestoreCourse(course)}
        onRetry={() => loadCourses(includeArchived)}
      />
    ),
    about: <AboutPanel />
  } satisfies Record<CategoryId, ReactNode>

  const groups: readonly CategoryGroup[] = ['settings', 'workspace', 'info']

  return (
    <div
      className={`settings-app${embedded ? ' settings-app--embedded' : ''}`}
    >
      {!embedded && (
        <header className="settings-titlebar titlebar-drag">
          <div className="settings-titlebar__brand">
            <BandalMark size={17} className="settings-titlebar__moon" />
            <span>{t('settings.app.name')}</span>
          </div>
          <span className="settings-titlebar__divider" aria-hidden="true" />
          <span className="settings-titlebar__label">
            {t('settings.window.title')}
          </span>
        </header>
      )}

      <div className="settings-layout">
        <aside
          className="settings-sidebar"
          aria-label={t('settings.navigation.label')}
        >
          <button
            type="button"
            className="back-button"
            onClick={() => {
              if (embedded) onClose?.()
              else window.close()
            }}
          >
            <Icon name="arrow-left" size={17} />
            <span>{t('settings.back')}</span>
          </button>

          <label className="settings-search">
            <span className="visually-hidden">{t('settings.search.label')}</span>
            <Icon name="search" size={16} />
            <input
              type="search"
              value={query}
              placeholder={t('settings.search.placeholder')}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setQuery('')
              }}
            />
          </label>

          <nav className="settings-nav">
            {groups.map((group) => {
              const groupCategories = filteredCategories.filter(
                (category) => category.group === group
              )
              if (groupCategories.length === 0) return null
              return (
                <div className="settings-nav__group" key={group}>
                  <span className="settings-nav__group-label">
                    {t(`settings.group.${group}`)}
                  </span>
                  {groupCategories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      className={`settings-nav__item${
                        activeCategory === category.id
                          ? ' settings-nav__item--active'
                          : ''
                      }`}
                      aria-current={
                        activeCategory === category.id ? 'page' : undefined
                      }
                      onClick={() => setActiveCategory(category.id)}
                    >
                      <Icon name={category.id} />
                      <span>{category.label}</span>
                    </button>
                  ))}
                </div>
              )
            })}
            {filteredCategories.length === 0 && (
              <div className="settings-nav__empty">
                <Icon name="search" size={17} />
                <span>{t('settings.search.empty')}</span>
              </div>
            )}
          </nav>

          <div className="settings-sidebar__footer">
            <BandalMark size={14} className="settings-sidebar__footer-moon" />
            <span>{t('settings.tagline')}</span>
          </div>
        </aside>

        <main className="settings-content" tabIndex={-1}>
          <div className="settings-content__inner">
            <header className="content-heading">
              <span className="content-heading__eyebrow">
                {t('settings.eyebrow')}
              </span>
              <h1>{active.label}</h1>
              <p>{active.description}</p>
            </header>
            <div className="settings-panel" key={active.id}>
              {panel[active.id]}
            </div>
          </div>
        </main>
      </div>
      <ToastHost />
    </div>
  )
}
