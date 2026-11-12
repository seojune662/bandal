import { useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { DECOR_PALETTES, decorSwatchGradient, type DecorPaletteId } from '../../../../shared/decor'
import { useLocale } from '../../i18n'
import { useUiStore } from '../../stores/uiStore'
import './decor.css'

/**
 * 꾸미기 › 색 and 세기 (iPad NativeDecorSwatches / NativeDecorIntensitySlider).
 * Both write straight to the decor in force: the window repaints as the user
 * picks, so the choice is seen on the app itself.
 */
export function DecorPicker({ compact = false }: { compact?: boolean }): JSX.Element {
  const ko = useLocale() === 'ko-KR'
  const decor = useUiStore(state => state.decor)
  const setDecor = useUiStore(state => state.setDecor)
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const selected = Math.max(0, DECOR_PALETTES.findIndex(palette => palette.id === decor.palette))
  const choose = (id: DecorPaletteId): void => setDecor({ palette: id })
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? DECOR_PALETTES.length - 1 : step === 0 ? -1 : (selected + step + DECOR_PALETTES.length) % DECOR_PALETTES.length
    if (index < 0) return
    event.preventDefault()
    refs.current[index]?.focus()
    choose(DECOR_PALETTES[index]!.id)
  }
  const percent = Math.round(decor.intensity * 100)
  return (
    <div className="decor-picker" data-compact={compact || undefined}>
      <div className="decor-picker__row">
        <span className="decor-picker__label" id="decor-color-label">{ko ? '색' : 'Color'}</span>
        <div className="decor-picker__swatches" role="radiogroup" aria-label={ko ? '색 선택' : 'Choose a color'} onKeyDown={onKeyDown}>
          {DECOR_PALETTES.map((palette, index) => {
            const active = index === selected
            return (
              <button key={palette.id} ref={element => { refs.current[index] = element }} type="button" role="radio" aria-checked={active}
                tabIndex={active ? 0 : -1} className="decor-swatch" data-palette={palette.id} onClick={() => choose(palette.id)}>
                <span className="decor-swatch__disc" style={{ '--swatch': decorSwatchGradient(palette) } as CSSProperties} aria-hidden="true" />
                <span className="decor-swatch__name">{ko ? palette.title : palette.titleEn}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="decor-picker__row">
        <span className="decor-picker__label" id="decor-strength-label">{ko ? '세기' : 'Strength'}</span>
        <div className="decor-picker__slider">
          <span className="decor-picker__end">{ko ? '은은하게' : 'Subtle'}</span>
          <input type="range" min={0} max={1} step={0.05} value={decor.intensity} aria-labelledby="decor-strength-label"
            aria-valuetext={`${percent}%`} style={{ '--fill': `${percent}%` } as CSSProperties}
            onChange={event => setDecor({ intensity: Number(event.target.value) })} />
          <span className="decor-picker__end">{ko ? '선명하게' : 'Vivid'}</span>
        </div>
      </div>
    </div>
  )
}

/** A small window drawn with the decor: rail, panel and a page, over the backdrop (NativeDecorPreview). */
export function DecorPreview(): JSX.Element {
  return (
    <div className="decor-preview" aria-hidden="true">
      <div className="decor-preview__rail">{[0, 1, 2, 3].map(index => <span key={index} data-lit={index === 0 || undefined}><i /></span>)}</div>
      <div className="decor-preview__panel">{[70, 54, 82, 60, 46].map((width, index) => <span key={index} data-lit={index === 1 || undefined}><b /><i style={{ width }} /></span>)}</div>
      <div className="decor-preview__paper"><i className="decor-preview__heading" />{[210, 190, 220, 160, 200].map((width, index) => <i key={index} style={{ width }} />)}</div>
    </div>
  )
}
