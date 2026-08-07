import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { showToast, ToastHost } from '../../app/toast'
import { BandalMark } from '../../components/BandalMark'
import { useLocale, useT } from '../../i18n'
import { invoke, onPush } from '../../lib/ipc'
import type { AgentAvailability } from '../../../../shared/types/agent-events'
import type { Course } from '../../../../shared/types/course'
import type {
  Settings,
  ThemePreference
} from '../../../../shared/types/settings'
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

export function SettingsApp(): JSX.Element {
  const t = useT()
  const locale = useLocale()
  const [activeCategory, setActiveCategory] = useState<CategoryId>('general')
  const [query, setQuery] = useState('')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [theme, setTheme] = useState<ThemePreference>('dark')
  const [themeSaving, setThemeSaving] = useState(false)
  const [themeErrorKey, setThemeErrorKey] = useState<string | null>(null)
  const [availability, setAvailability] = useState<AgentAvailability | null>(null)
  const [availabilityLoading, setAvailabilityLoading] = useState(true)
  const [availabilityError, setAvailabilityError] = useState<string | null>(null)
  const [courses, setCourses] = useState<Course[]>([])
  const [coursesLoading, setCoursesLoading] = useState(true)
  const [coursesError, setCoursesError] = useState<string | null>(null)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [pendingCourseId, setPendingCourseId] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const categories = useMemo<readonly Category[]>(
    () => [
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

  const loadAvailability = (): void => {
    setAvailabilityLoading(true)
    setAvailabilityError(null)
    void invoke('agent:availability', { provider: 'claude-code' })
      .then((result) => {
        if (mountedRef.current) setAvailability(result)
      })
      .catch(() => {
        if (mountedRef.current) setAvailabilityError('availability-failed')
      })
      .finally(() => {
        if (mountedRef.current) setAvailabilityLoading(false)
      })
  }

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
      applyTheme(next.theme)
    })

    void invoke('settings:get', {})
      .then((result) => {
        if (!mountedRef.current) return
        setSettings(result)
        setTheme(result.theme)
        applyTheme(result.theme)
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
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const handleChange = (): void => {
      if (theme === 'system') applyTheme('system')
    }
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [theme])

  const handleThemeSelect = (nextTheme: ThemePreference): void => {
    if (nextTheme === theme || themeSaving) return
    const previousTheme = theme
    setTheme(nextTheme)
    applyTheme(nextTheme)
    setThemeSaving(true)
    setThemeErrorKey(null)

    void invoke('settings:set', { theme: nextTheme })
      .then((nextSettings) => {
        if (!mountedRef.current) return
        setSettings(nextSettings)
        setTheme(nextSettings.theme)
        applyTheme(nextSettings.theme)
      })
      .catch(() => {
        if (!mountedRef.current) return
        setTheme(previousTheme)
        applyTheme(previousTheme)
        setThemeErrorKey('settings.appearance.saveFailed')
      })
      .finally(() => {
        if (mountedRef.current) setThemeSaving(false)
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
    general: <GeneralPanel settings={settings} />,
    appearance: (
      <AppearancePanel
        theme={theme}
        saving={themeSaving}
        error={themeErrorKey === null ? null : t(themeErrorKey)}
        onSelect={handleThemeSelect}
      />
    ),
    ai: (
      <AiPanel
        availability={availability}
        loading={availabilityLoading}
        error={availabilityError}
        onRetry={loadAvailability}
      />
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
    <div className="settings-app">
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

      <div className="settings-layout">
        <aside
          className="settings-sidebar"
          aria-label={t('settings.navigation.label')}
        >
          <button type="button" className="back-button" onClick={() => window.close()}>
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
