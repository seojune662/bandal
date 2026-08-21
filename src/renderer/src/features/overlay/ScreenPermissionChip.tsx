import type { ScreenPermissionState } from '../../../../shared/types/overlay'

export interface ScreenPermissionChipProps {
  state: ScreenPermissionState
  onClick?: () => void
}

export function ScreenPermissionChip({
  state,
  onClick
}: ScreenPermissionChipProps): JSX.Element | null {
  if (state === 'unsupported') return null

  const granted = state === 'granted'
  const label = granted ? '화면 보기 허용됨' : '화면 보기 허용 필요'
  const shortLabel = granted ? '허용' : '필요'
  const className = 'overlay-screen-permission'
  const content = (
    <>
      <svg
        className="overlay-screen-permission__icon"
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        <rect x="2.5" y="3" width="11" height="8" rx="1.5" />
        <path d="M6 13h4M8 11v2" />
      </svg>
      <span className="overlay-screen-permission__label">{shortLabel}</span>
    </>
  )

  if (granted) {
    return (
      <span
        className={className}
        data-state="granted"
        role="status"
        aria-label={label}
        title={label}
      >
        {content}
      </span>
    )
  }

  return (
    <button
      type="button"
      className={className}
      data-state="needed"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {content}
    </button>
  )
}
