import { useRef } from 'react'
import type { CSSProperties, KeyboardEvent, MutableRefObject, ReactNode } from 'react'
import { Check } from 'lucide-react'

import { SYSTEM_THEME } from '../../../../shared/theme'
import type { ThemeId } from '../../../../shared/theme'
import { DENSITIES, EDITOR_FONTS, FONT_SCALES } from '../../../../shared/types/settings'
import type { Density, EditorFont, FontScale, ThemePreference } from '../../../../shared/types/settings'
import { useT } from '../../i18n'
import { cn } from '../../lib/utils'
import { SettingsGroup, SettingsSegmentedRow, SettingsStack } from './kit/SettingsKit'
import { useIsSettingsSearching } from './kit/SettingsSearchContext'
import { DecorPicker } from '../decor/DecorPicker'

const THEME_OPTIONS: readonly ThemePreference[] = ['system', 'light', 'dark']

const FONT_FAMILY_CLASS: Record<EditorFont, string> = {
  sans: 'font-sans',
  serif: 'font-serif',
  mono: 'font-mono'
}

function fontScaleLabel(scale: FontScale): string {
  return `${Math.round(scale * 100)}%`
}

/** Points the preview at one mode's swatch tokens (tokens.css --preview-*). */
function swatchVars(mode: ThemeId): CSSProperties {
  const cell = `--preview-${mode}`
  return {
    '--preview-bg': `var(${cell}-bg)`,
    '--preview-surface': `var(${cell}-surface)`,
    '--preview-text': `var(${cell}-text)`,
    '--preview-accent': `var(${cell}-accent)`
  } as CSSProperties
}

function PreviewBody(): JSX.Element {
  return (
    <>
      <span className="absolute inset-y-0 left-0 w-[30%] bg-(--preview-surface)" />
      <span className="absolute top-[17%] left-[8%] h-[10%] w-[14%] rounded-full bg-(--preview-accent)" />
      <span className="absolute top-[33%] right-[12%] left-[40%] h-[7%] rounded-full bg-(--preview-text)" />
      <span className="absolute top-[55%] right-[38%] left-[40%] h-[7%] rounded-full bg-(--preview-text) opacity-55" />
    </>
  )
}

const PREVIEW_FRAME = 'relative block aspect-[1.62] w-full overflow-hidden rounded-sm border border-border'
const PREVIEW_HALF = 'relative block min-w-0 flex-1 overflow-hidden bg-(--preview-bg)'

function ThemePreview({ theme }: { theme: ThemePreference }): JSX.Element {
  if (theme === 'system') {
    return (
      <span className={cn(PREVIEW_FRAME, 'flex')} aria-hidden="true">
        <span className={PREVIEW_HALF} style={swatchVars(SYSTEM_THEME.dark)}>
          <PreviewBody />
        </span>
        <span className={PREVIEW_HALF} style={swatchVars(SYSTEM_THEME.light)}>
          <PreviewBody />
        </span>
      </span>
    )
  }
  return (
    <span className={cn(PREVIEW_FRAME, 'bg-(--preview-bg)')} style={swatchVars(theme)} aria-hidden="true">
      <PreviewBody />
    </span>
  )
}

/** Three rows of chrome at the option's rhythm — the gap IS the preview. */
function DensityPreview({ density }: { density: Density }): JSX.Element {
  const compact = density === 'compact'
  return (
    <span
      className={cn(
        'flex h-17 flex-col overflow-hidden rounded-sm border border-border bg-card',
        compact ? 'gap-[0.3rem] p-[0.3rem]' : 'gap-2 p-2'
      )}
      aria-hidden="true"
    >
      <span className={cn('flex-none rounded-full bg-primary opacity-85', compact ? 'h-[0.55rem]' : 'h-3')} />
      <span className="h-[0.45rem] flex-none rounded-full bg-border-strong opacity-55" />
      <span className="h-[0.45rem] flex-none rounded-full bg-border-strong opacity-55" />
      <span className="h-[0.45rem] w-[55%] flex-none rounded-full bg-border-strong opacity-55" />
    </span>
  )
}

/**
 * Roving-tabindex keyboard model for the preview-card radiogroups:
 * arrows move *and* select (the preview is the feedback), Home/End jump.
 */
function useRovingRadios<T extends string>(
  options: readonly T[],
  value: T,
  onSelect: (next: T) => void
): {
  refs: MutableRefObject<Array<HTMLButtonElement | null>>
  selectedIndex: number
  handleKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
} {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = Math.max(0, options.indexOf(value))

  const moveTo = (index: number): void => {
    const count = options.length
    const next = ((index % count) + count) % count
    refs.current[next]?.focus()
    onSelect(options[next]!)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current = options.indexOf(value)
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        moveTo(current + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        moveTo(current - 1)
        break
      case 'Home':
        event.preventDefault()
        moveTo(0)
        break
      case 'End':
        event.preventDefault()
        moveTo(options.length - 1)
        break
      default:
        break
    }
  }

  return { refs, selectedIndex, handleKeyDown }
}

/** Big visual radio cards: only where the preview is the point (theme, density). */
function PreviewCards<T extends string>({
  options,
  value,
  onSelect,
  label,
  busy,
  columns,
  preview,
  copy
}: {
  options: readonly T[]
  value: T
  onSelect: (next: T) => void
  label: string
  busy: boolean
  columns: string
  preview: (option: T) => ReactNode
  copy: (option: T) => { label: string; description: string }
}): JSX.Element {
  const radios = useRovingRadios(options, value, onSelect)
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-busy={busy}
      onKeyDown={radios.handleKeyDown}
      className={cn('grid gap-3', columns)}
    >
      {options.map((option, index) => {
        const selected = value === option
        const text = copy(option)
        return (
          <button
            key={option}
            type="button"
            role="radio"
            ref={node => {
              radios.refs.current[index] = node
            }}
            aria-checked={selected}
            tabIndex={index === radios.selectedIndex ? 0 : -1}
            onClick={() => onSelect(option)}
            data-selected={selected || undefined}
            className={cn(
              'flex min-w-0 flex-col-reverse gap-2 rounded-md border bg-background p-2 text-left transition-[border-color,background-color,transform] duration-(--dur-fast) active:translate-y-px',
              selected ? 'border-foreground' : 'border-border hover:border-border-strong hover:bg-secondary',
              busy && 'cursor-wait'
            )}
          >
            {/* Copy comes first in the DOM so the radio's name starts with its label. */}
            <span className="flex flex-col gap-0.5 px-0.5 pb-0.5">
              <span className="flex items-center justify-between gap-2 text-sm font-medium text-foreground">
                {text.label}
                <span
                  className={cn(
                    'inline-flex size-4.5 shrink-0 items-center justify-center rounded-full',
                    selected && 'bg-primary text-primary-foreground'
                  )}
                >
                  {selected && <Check className="size-3" aria-hidden="true" />}
                </span>
              </span>
              <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">{text.description}</span>
            </span>
            {preview(option)}
          </button>
        )
      })}
    </div>
  )
}

export function AppearancePanel({
  theme,
  fontScale,
  editorFont,
  density,
  saving,
  error,
  onSelect,
  onSelectFontScale,
  onSelectEditorFont,
  onSelectDensity
}: {
  theme: ThemePreference
  fontScale: FontScale
  editorFont: EditorFont
  density: Density
  saving: boolean
  error: string | null
  onSelect: (theme: ThemePreference) => void
  onSelectFontScale: (fontScale: FontScale) => void
  onSelectEditorFont: (editorFont: EditorFont) => void
  onSelectDensity: (density: Density) => void
}): JSX.Element {
  const t = useT()
  const searching = useIsSettingsSearching()

  return (
    <SettingsStack>
      <SettingsGroup searchId="appearance.theme">
        <div className="space-y-3 px-4 py-4">
          <PreviewCards
            options={THEME_OPTIONS}
            value={theme}
            onSelect={onSelect}
            label={t('settings.appearance.theme.selectLabel')}
            busy={saving}
            columns="grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]"
            preview={option => <ThemePreview theme={option} />}
            copy={option => ({
              label: t(`settings.appearance.theme.${option}.label`),
              description: t(`settings.appearance.theme.${option}.description`)
            })}
          />
          <p className="text-xs leading-relaxed text-muted-foreground select-text">
            {t('settings.appearance.theme.note')}
          </p>
        </div>
      </SettingsGroup>

      <SettingsGroup searchId="appearance.decor">
        <DecorPicker />
      </SettingsGroup>

      <SettingsGroup searchId="appearance.text">
        <SettingsSegmentedRow
          searchId="appearance.text.scale"
          value={String(fontScale)}
          options={FONT_SCALES.map(option => ({ value: String(option), label: fontScaleLabel(option) }))}
          onChange={next => {
            const scale = FONT_SCALES.find(option => String(option) === next)
            if (scale !== undefined) onSelectFontScale(scale)
          }}
        />
        <SettingsSegmentedRow
          searchId="appearance.text.editorFont"
          value={editorFont}
          options={EDITOR_FONTS.map(option => ({
            value: option,
            label: (
              <span className={FONT_FAMILY_CLASS[option]}>{t(`settings.appearance.font.family.${option}.label`)}</span>
            ),
            tooltip: t(`settings.appearance.font.family.${option}.description`)
          }))}
          onChange={onSelectEditorFont}
        />
      </SettingsGroup>

      <SettingsGroup searchId="appearance.density">
        <div className="px-4 py-4">
          <PreviewCards
            options={DENSITIES}
            value={density}
            onSelect={onSelectDensity}
            label={t('settings.appearance.density.selectLabel')}
            busy={saving}
            columns="grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))]"
            preview={option => <DensityPreview density={option} />}
            copy={option => ({
              label: t(`settings.appearance.density.${option}.label`),
              description: t(`settings.appearance.density.${option}.description`)
            })}
          />
        </div>
      </SettingsGroup>

      {/* One status line for every appearance knob: they share the optimistic save. */}
      {(!searching || error !== null) && (
        <p
          className={cn('-mt-4 min-h-4.5 px-1 text-xs', error !== null ? 'text-destructive' : 'text-muted-foreground')}
          role={error !== null ? 'alert' : undefined}
          aria-live="polite"
        >
          {error ?? (saving ? t('settings.appearance.saving') : t('settings.appearance.saved'))}
        </p>
      )}
    </SettingsStack>
  )
}
