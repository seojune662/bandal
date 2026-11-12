/**
 * Settings row kit. Layout and API follow Orca's components/settings/
 * SettingsFormControls.tsx + SettingsSection.tsx (MIT): label and description
 * on the left, one control on the right, rows banded into a card per group.
 *
 * Every row/group takes an optional `searchId` (see search/entries). With it,
 * the label and description default to the catalog copy, the row hides when
 * the settings search does not match it, and deep links can scroll to it via
 * `data-settings-target`.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { Input } from '../../../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../../components/ui/select'
import { Switch } from '../../../components/ui/switch'
import { SimpleTooltip } from '../../../components/ui/tooltip'
import { cn } from '../../../lib/utils'
import {
  SettingsGroupMatchProvider,
  useSettingsEntry,
  useSettingsSearchVisibility
} from './SettingsSearchContext'

/* ------------------------------------------------------------------ group */

interface SettingsGroupProps {
  searchId?: string
  title?: ReactNode
  description?: ReactNode
  /** Right-aligned header action (e.g. "Import…"). */
  action?: ReactNode
  /** Render children without the card band (lists, custom layouts). */
  bare?: boolean
  className?: string
  children: ReactNode
}

export function SettingsGroup({
  searchId,
  title,
  description,
  action,
  bare = false,
  className,
  children
}: SettingsGroupProps): JSX.Element | null {
  const entry = useSettingsEntry(searchId)
  const { visible, selfMatches } = useSettingsSearchVisibility(searchId, { isGroup: true })
  if (!visible) return null
  const heading = title ?? entry?.title
  const copy = description ?? entry?.description
  return (
    <section
      data-settings-group={searchId}
      data-settings-target={searchId}
      className={cn('scroll-mt-6', className)}
    >
      {(heading !== undefined || action !== undefined) && (
        <div className="mb-2.5 flex items-end justify-between gap-4 px-1">
          <div className="min-w-0 space-y-0.5">
            {heading !== undefined && (
              <h2 className="text-sm font-medium tracking-tight text-foreground">{heading}</h2>
            )}
            {copy !== undefined && (
              <p className="text-xs leading-relaxed text-muted-foreground select-text">{copy}</p>
            )}
          </div>
          {action !== undefined && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <SettingsGroupMatchProvider value={selfMatches}>
        {bare ? (
          children
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-(--paper)">
            {children}
          </div>
        )}
      </SettingsGroupMatchProvider>
    </section>
  )
}

/** Vertical rhythm between groups inside one panel. */
export function SettingsStack({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={cn('flex flex-col gap-7', className)}>{children}</div>
}

/* -------------------------------------------------------------------- row */

interface SettingsRowProps {
  searchId?: string
  label?: ReactNode
  description?: ReactNode
  /** Small pill after the label (Beta, 실험, …). */
  badge?: ReactNode
  control?: ReactNode
  /** Content under the label/control line (sub-options, inline errors). */
  footer?: ReactNode
  alignTop?: boolean
  disabled?: boolean
  /** Why the control is disabled; shown under the description. */
  disabledReason?: ReactNode
  labelId?: string
  className?: string
}

export function SettingsRow({
  searchId,
  label,
  description,
  badge,
  control,
  footer,
  alignTop = false,
  disabled = false,
  disabledReason,
  labelId,
  className
}: SettingsRowProps): JSX.Element | null {
  const entry = useSettingsEntry(searchId)
  const { visible } = useSettingsSearchVisibility(searchId)
  if (!visible) return null
  const text = label ?? entry?.title
  const copy = description ?? entry?.description
  return (
    <div
      data-settings-target={searchId}
      className={cn(
        'scroll-mt-6 px-4 py-3.5 transition-[background-color,box-shadow] duration-(--dur-base) data-[highlighted=true]:bg-selected/60 data-[highlighted=true]:shadow-[inset_2px_0_0_var(--color-primary)]',
        className
      )}
    >
      <div className={cn('flex gap-6', alignTop ? 'items-start' : 'items-center')}>
        <div className={cn('min-w-0 flex-1 space-y-0.5', disabled && 'opacity-60')}>
          <div className="flex flex-wrap items-center gap-2">
            <span id={labelId} className="text-sm font-medium text-foreground">
              {text}
            </span>
            {badge}
          </div>
          {copy !== undefined && (
            <p className="text-xs leading-relaxed text-muted-foreground select-text">{copy}</p>
          )}
          {disabled && disabledReason !== undefined && (
            <p className="text-xs leading-relaxed text-muted-foreground select-text">{disabledReason}</p>
          )}
        </div>
        {control !== undefined && <div className="flex shrink-0 items-center gap-2">{control}</div>}
      </div>
      {footer !== undefined && <div className="mt-3">{footer}</div>}
    </div>
  )
}

/* ----------------------------------------------------------------- switch */

interface SettingsSwitchRowProps extends Omit<SettingsRowProps, 'control'> {
  checked: boolean
  onChange: (next: boolean) => void
}

export function SettingsSwitchRow({ checked, onChange, ...row }: SettingsSwitchRowProps): JSX.Element {
  const labelId = useId()
  return (
    <SettingsRow
      {...row}
      labelId={labelId}
      control={
        <Switch
          checked={checked}
          disabled={row.disabled}
          aria-labelledby={labelId}
          onCheckedChange={onChange}
        />
      }
    />
  )
}

/* -------------------------------------------------------------- segmented */

export interface SettingsOption<T extends string> {
  value: T
  label: ReactNode
  disabled?: boolean
  /** Explains a disabled option; shown as a tooltip. */
  tooltip?: string
}

interface SettingsSegmentedProps<T extends string> {
  value: T
  options: readonly SettingsOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  ariaLabelledBy?: string
  ariaLabel?: string
  className?: string
}

/**
 * Single-choice segmented control (radiogroup). Orca's
 * SettingsSegmentedControl; disabled options stay focusable so their tooltip
 * can explain why.
 */
export function SettingsSegmented<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabelledBy,
  ariaLabel,
  className
}: SettingsSegmentedProps<T>): JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-labelledby={ariaLabelledBy}
      aria-label={ariaLabel}
      className={cn('inline-flex w-fit items-center gap-0.5 rounded-md border border-border bg-secondary p-0.5', className)}
    >
      {options.map(option => {
        const active = option.value === value
        const unavailable = disabled || option.disabled === true
        const button = (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-disabled={unavailable || undefined}
            onClick={() => {
              if (!unavailable && !active) onChange(option.value)
            }}
            className={cn(
              'inline-flex h-7 items-center justify-center gap-1.5 rounded-sm px-3 text-xs font-medium whitespace-nowrap transition-[color,background-color,box-shadow] duration-(--dur-fast)',
              active
                ? 'bg-background text-foreground shadow-sm'
                : unavailable
                  ? 'cursor-not-allowed text-muted-foreground/50'
                  : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {option.label}
          </button>
        )
        return option.tooltip === undefined ? (
          button
        ) : (
          <SimpleTooltip key={option.value} label={option.tooltip}>
            {button}
          </SimpleTooltip>
        )
      })}
    </div>
  )
}

interface SettingsSegmentedRowProps<T extends string> extends Omit<SettingsRowProps, 'control'> {
  value: T
  options: readonly SettingsOption<T>[]
  onChange: (value: T) => void
}

export function SettingsSegmentedRow<T extends string>({
  value,
  options,
  onChange,
  ...row
}: SettingsSegmentedRowProps<T>): JSX.Element {
  const labelId = useId()
  return (
    <SettingsRow
      {...row}
      labelId={labelId}
      control={
        <SettingsSegmented
          value={value}
          options={options}
          onChange={onChange}
          disabled={row.disabled ?? false}
          ariaLabelledBy={labelId}
        />
      }
    />
  )
}

/* ----------------------------------------------------------------- select */

interface SettingsSelectProps<T extends string> {
  value: T
  options: readonly SettingsOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  ariaLabelledBy?: string
  ariaLabel?: string
  placeholder?: string
  className?: string
}

export function SettingsSelect<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabelledBy,
  ariaLabel,
  placeholder,
  className
}: SettingsSelectProps<T>): JSX.Element {
  return (
    <Select value={value} disabled={disabled} onValueChange={next => onChange(next as T)}>
      <SelectTrigger
        className={cn('min-w-40', className)}
        aria-labelledby={ariaLabelledBy}
        aria-label={ariaLabel}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent align="end">
        {options.map(option => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled ?? false}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

interface SettingsSelectRowProps<T extends string> extends Omit<SettingsRowProps, 'control'> {
  value: T
  options: readonly SettingsOption<T>[]
  onChange: (value: T) => void
  placeholder?: string
  selectClassName?: string
}

export function SettingsSelectRow<T extends string>({
  value,
  options,
  onChange,
  placeholder,
  selectClassName,
  ...row
}: SettingsSelectRowProps<T>): JSX.Element {
  const labelId = useId()
  return (
    <SettingsRow
      {...row}
      labelId={labelId}
      control={
        <SettingsSelect
          value={value}
          options={options}
          onChange={onChange}
          disabled={row.disabled ?? false}
          ariaLabelledBy={labelId}
          {...(placeholder !== undefined ? { placeholder } : {})}
          {...(selectClassName !== undefined ? { className: selectClassName } : {})}
        />
      }
    />
  )
}

/* ------------------------------------------------------------------- text */

interface SettingsTextRowProps extends Omit<SettingsRowProps, 'control' | 'footer'> {
  value: string
  /**
   * Persist the draft. Return an error message to keep the draft and mark the
   * field invalid; resolve to undefined on success.
   */
  onCommit: (value: string) => Promise<string | undefined> | string | undefined
  placeholder?: string
  type?: 'text' | 'url' | 'email'
  /** Text fields autosave on blur/Enter; `debounceMs` also saves while typing. */
  debounceMs?: number
  inputClassName?: string
  /** Stack the input under the copy instead of beside it (long values). */
  wide?: boolean
  maxLength?: number
  autoComplete?: string
}

/**
 * Autosaving text field (Orca's DebouncedSettingsTextInput + commit-on-blur).
 * Escape reverts the draft. A failed commit keeps the draft, sets
 * aria-invalid and shows the message under the row.
 */
export function SettingsTextRow({
  value,
  onCommit,
  placeholder,
  type = 'text',
  debounceMs,
  inputClassName,
  wide = false,
  maxLength,
  autoComplete,
  ...row
}: SettingsTextRowProps): JSX.Element {
  const labelId = useId()
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const committed = useRef(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    committed.current = value
    setDraft(value)
    setError(null)
  }, [value])
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current)
  }, [])

  const commit = async (next: string): Promise<void> => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (next === committed.current) return
    const message = await onCommit(next)
    if (message === undefined) {
      committed.current = next
      setError(null)
    } else {
      setError(message)
    }
  }

  const input = (
    <Input
      type={type}
      value={draft}
      placeholder={placeholder}
      maxLength={maxLength}
      autoComplete={autoComplete}
      disabled={row.disabled}
      aria-labelledby={labelId}
      aria-invalid={error !== null || undefined}
      spellCheck={false}
      className={cn(wide ? 'w-full' : 'w-64', inputClassName)}
      onChange={event => {
        const next = event.target.value
        setDraft(next)
        if (debounceMs !== undefined) {
          if (timer.current !== null) clearTimeout(timer.current)
          timer.current = setTimeout(() => void commit(next), debounceMs)
        }
      }}
      onBlur={() => void commit(draft)}
      onKeyDown={event => {
        if (event.key === 'Enter') void commit(draft)
        if (event.key === 'Escape' && draft !== committed.current) {
          event.stopPropagation()
          setDraft(committed.current)
          setError(null)
        }
      }}
    />
  )
  const errorLine =
    error === null ? undefined : (
      <p role="alert" className="text-xs text-destructive">
        {error}
      </p>
    )
  return wide ? (
    <SettingsRow
      {...row}
      labelId={labelId}
      footer={
        <div className="space-y-1.5">
          {input}
          {errorLine}
        </div>
      }
    />
  ) : (
    <SettingsRow {...row} labelId={labelId} control={input} {...(errorLine !== undefined ? { footer: errorLine } : {})} />
  )
}

/* ---------------------------------------------------------- empty, notice */

export function SettingsEmptyState({
  icon,
  title,
  description,
  action,
  className
}: {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong px-6 py-8 text-center',
        className
      )}
    >
      {icon !== undefined && <div className="text-muted-foreground [&_svg]:size-5">{icon}</div>}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description !== undefined && <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>}
      {action !== undefined && <div className="mt-1">{action}</div>}
    </div>
  )
}

export function SettingsNotice({
  tone = 'info',
  icon,
  children,
  action,
  className
}: {
  tone?: 'info' | 'warning' | 'danger'
  icon?: ReactNode
  children: ReactNode
  action?: ReactNode
  className?: string
}): JSX.Element {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-center gap-3 rounded-lg border px-4 py-3 text-xs leading-relaxed',
        tone === 'info' && 'border-border bg-secondary/60 text-secondary-foreground',
        tone === 'warning' && 'border-highlight/60 bg-highlight/15 text-foreground',
        tone === 'danger' && 'border-destructive/35 bg-destructive-muted text-destructive',
        className
      )}
    >
      {icon !== undefined && <span className="shrink-0 [&_svg]:size-4">{icon}</span>}
      <div className="min-w-0 flex-1 select-text">{children}</div>
      {action !== undefined && <div className="shrink-0">{action}</div>}
    </div>
  )
}
