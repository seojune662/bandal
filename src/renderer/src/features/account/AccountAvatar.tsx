import { normalizeCourseColor } from '../courses/courseColors'
import './account.css'

interface AccountAvatarProps {
  color: string
  emoji: string
  nickname: string
  size?: 'sm' | 'md' | 'lg'
}

export function AccountAvatar({
  color,
  emoji,
  nickname,
  size = 'md'
}: AccountAvatarProps): JSX.Element {
  return (
    <span
      className="account-avatar"
      data-avatar-color={normalizeCourseColor(color === 'moon' ? 'gold' : color)}
      data-size={size}
      aria-hidden="true"
      title={nickname}
    >
      {emoji}
    </span>
  )
}
