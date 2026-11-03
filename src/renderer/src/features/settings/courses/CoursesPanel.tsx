import { BookOpen } from 'lucide-react'

import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import type { Course } from '../../../../../shared/types/course'
import { useLocale, useT } from '../../../i18n'
import {
  SettingsEmptyState,
  SettingsGroup,
  SettingsNotice,
  SettingsRow,
  SettingsStack,
  SettingsSwitchRow
} from '../kit/SettingsKit'

export function CoursesPanel({
  courses,
  loading,
  error,
  includeArchived,
  pendingCourseId,
  onIncludeArchivedChange,
  onRestore,
  onRetry
}: {
  courses: Course[]
  loading: boolean
  error: string | null
  includeArchived: boolean
  pendingCourseId: string | null
  onIncludeArchivedChange: (next: boolean) => void
  onRestore: (course: Course) => void
  onRetry: () => void
}): JSX.Element {
  const t = useT()
  const locale = useLocale()
  const courseCount = new Intl.NumberFormat(locale).format(courses.length)

  let list: JSX.Element
  if (loading) {
    list = (
      <div
        role="status"
        aria-label={t('settings.courses.loading')}
        className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card/60"
      >
        {[0, 1, 2].map(index => (
          <div key={index} className="flex items-center gap-3 px-4 py-3.5">
            <span className="size-4 animate-pulse rounded-sm bg-muted" />
            <span className="h-3 w-40 animate-pulse rounded-sm bg-muted" />
          </div>
        ))}
      </div>
    )
  } else if (error !== null) {
    list = (
      <SettingsNotice
        tone="danger"
        action={
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t('settings.courses.reload')}
          </Button>
        }
      >
        <p className="font-medium">{t('settings.courses.loadFailed')}</p>
        <p>{t('settings.courses.loadFailedHelp')}</p>
      </SettingsNotice>
    )
  } else if (courses.length === 0) {
    list = (
      <SettingsEmptyState
        icon={<BookOpen />}
        title={t('settings.courses.empty')}
        description={t('settings.courses.emptyHelp')}
      />
    )
  } else {
    list = (
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card/60">
        {courses.map(course => {
          const restoreLabel = t('settings.courses.restore')
          return (
            <SettingsRow
              key={course.id}
              label={course.name}
              description={course.slug}
              {...(course.archived
                ? {
                    badge: <Badge variant="outline">{t('settings.courses.archived')}</Badge>,
                    control: (
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={t('settings.courses.restoreNamed', { name: course.name })}
                        disabled={pendingCourseId !== null}
                        onClick={() => onRestore(course)}
                      >
                        {pendingCourseId === course.id ? t('settings.courses.restoring') : restoreLabel}
                      </Button>
                    )
                  }
                : {})}
            />
          )
        })}
      </div>
    )
  }

  return (
    <SettingsStack>
      <SettingsGroup searchId="courses.display">
        <SettingsSwitchRow
          searchId="courses.display.showArchived"
          checked={includeArchived}
          onChange={onIncludeArchivedChange}
        />
      </SettingsGroup>

      <SettingsGroup
        searchId="courses.list"
        bare
        {...(!loading && error === null
          ? { action: <Badge variant="default">{courseCount}</Badge> }
          : {})}
      >
        <div aria-live="polite" aria-busy={pendingCourseId !== null}>
          {list}
        </div>
      </SettingsGroup>
    </SettingsStack>
  )
}
