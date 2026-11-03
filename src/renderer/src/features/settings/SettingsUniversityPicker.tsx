import { useId, useMemo, useState } from 'react'
import { Check, Plus, Search } from 'lucide-react'

import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { cn } from '../../lib/utils'
import { searchUniversities } from '../../../../shared/universities'
import type { CustomUniversityInput, University } from '../../../../shared/types/university'
import { useLocale, useT } from '../../i18n'

interface SettingsUniversityPickerProps {
  selectedId: string | null
  customName?: string | undefined
  onSelectPreset: (universityId: string) => void
  onAddCustom: (input: CustomUniversityInput) => Promise<boolean>
  busy?: boolean
}

function displayName(university: University, locale: ReturnType<typeof useLocale>): string {
  return locale === 'en-US' && university.nameEn.length > 0 ? university.nameEn : university.nameKo
}

export function SettingsUniversityPicker({
  selectedId,
  customName,
  onSelectPreset,
  onAddCustom,
  busy = false
}: SettingsUniversityPickerProps): JSX.Element {
  const t = useT()
  const locale = useLocale()
  const [query, setQuery] = useState('')
  const [customOpen, setCustomOpen] = useState(false)
  const [customNameDraft, setCustomNameDraft] = useState('')
  const [customUrl, setCustomUrl] = useState('')
  const nameId = useId()
  const urlId = useId()
  const hintId = useId()

  const results = useMemo(() => searchUniversities(query), [query])
  const trimmedQuery = query.trim()
  const customSelected = selectedId !== null && customName !== undefined && customName.length > 0

  const openCustomForm = (): void => {
    setCustomNameDraft(trimmedQuery)
    setCustomOpen(true)
  }

  const submitCustom = (event: React.FormEvent): void => {
    event.preventDefault()
    const nameKo = customNameDraft.trim()
    if (busy || nameKo.length === 0) return
    const courseUrl = customUrl.trim()
    void onAddCustom(courseUrl.length > 0 ? { nameKo, courseUrl } : { nameKo }).then((saved) => {
      if (!saved) return
      setCustomOpen(false)
      setCustomUrl('')
      setQuery('')
    })
  }

  return (
    <div className="space-y-2.5">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          className="pl-8"
          aria-label={t('settings.university.picker.searchLabel')}
          placeholder={t('settings.university.picker.searchPlaceholder')}
          value={query}
          autoComplete="off"
          disabled={busy}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {customSelected && (
        <p className="text-xs text-muted-foreground">
          {t('settings.university.picker.currentCustom', { name: customName })}
        </p>
      )}

      {results.length > 0 ? (
        <ul
          className="max-h-60 divide-y divide-border overflow-y-auto rounded-md border border-border bg-background"
          role="listbox"
          aria-label={t('settings.university.picker.listLabel')}
        >
          {results.map((university) => {
            const selected = university.id === selectedId
            return (
              <li key={university.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-selected={selected}
                  disabled={busy}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors duration-(--dur-fast) hover:bg-accent focus-visible:bg-accent disabled:opacity-50',
                    selected && 'bg-selected'
                  )}
                  onClick={() => onSelectPreset(university.id)}
                >
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-sm text-foreground', selected && 'font-medium')}>
                      {displayName(university, locale)}
                    </span>
                    <span className="block truncate text-2xs text-muted-foreground">
                      {university.domain} ·{' '}
                      {university.verifiedAt.length === 0
                        ? t('settings.university.noVerifiedAt')
                        : t('settings.university.verifiedAt', { date: university.verifiedAt })}
                    </span>
                  </span>
                  {selected && <Check aria-hidden="true" className="size-4 shrink-0 text-foreground" />}
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-border-strong px-3 py-3 text-xs text-muted-foreground">
          {t('settings.university.picker.zero')}
        </p>
      )}

      {!customOpen ? (
        <Button variant="ghost" size="sm" disabled={busy} onClick={openCustomForm}>
          <Plus aria-hidden="true" />
          {trimmedQuery.length > 0
            ? t('settings.university.picker.addNamed', { name: trimmedQuery })
            : t('settings.university.picker.addUnlisted')}
        </Button>
      ) : (
        <form className="space-y-2.5 rounded-md border border-border bg-secondary/40 p-3" onSubmit={submitCustom}>
          <div className="space-y-1">
            <Label htmlFor={nameId}>{t('settings.university.picker.name')}</Label>
            <Input
              id={nameId}
              value={customNameDraft}
              placeholder={t('settings.university.picker.namePlaceholder')}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => setCustomNameDraft(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={urlId}>
              {t('settings.university.picker.courseUrl')}{' '}
              <span className="font-normal text-muted-foreground">{t('settings.university.picker.optional')}</span>
            </Label>
            <Input
              id={urlId}
              value={customUrl}
              placeholder={t('settings.university.picker.urlPlaceholder')}
              autoComplete="off"
              disabled={busy}
              aria-describedby={hintId}
              onChange={(event) => setCustomUrl(event.target.value)}
            />
            <p id={hintId} className="text-2xs leading-relaxed text-muted-foreground">
              {t('settings.university.picker.urlHelp')}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setCustomOpen(false)}>
              {t('settings.university.picker.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={busy || customNameDraft.trim().length === 0}>
              {t('settings.university.picker.add')}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
