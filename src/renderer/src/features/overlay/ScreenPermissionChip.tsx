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
  const className = 'overlay-screen-permission'

  if (onClick !== undefined) {
    return (
      <button
        type="button"
        className={className}
        data-state={granted ? 'granted' : 'needed'}
        onClick={onClick}
      >
        {label}
      </button>
    )
  }

  return (
    <span
      className={className}
      data-state={granted ? 'granted' : 'needed'}
    >
      {label}
    </span>
  )
}
