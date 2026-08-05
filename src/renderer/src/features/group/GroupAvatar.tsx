/**
 * Avatar = emoji on a course-colored disc. There are no uploaded images
 * anywhere in Phase 2 (docs/phase2-community.md decision #10): Storage cost
 * stays zero and there is no image-moderation surface to staff.
 */

import { normalizeCourseColor } from '../courses/courseColors'

interface GroupAvatarProps {
  emoji: string
  color: string
  nickname: string
  size?: 'sm' | 'md'
  /** Renders the presence ring when the member is subscribed right now. */
  online?: boolean
}

export function GroupAvatar({
  emoji,
  color,
  nickname,
  size = 'md',
  online = false
}: GroupAvatarProps): JSX.Element {
  return (
    <span
      className="group-avatar"
      data-size={size}
      data-online={online || undefined}
      data-course-color={normalizeCourseColor(color)}
      // The nickname is always adjacent in the DOM, so the disc itself is
      // decorative — announcing the emoji twice just adds noise.
      aria-hidden="true"
      title={nickname}
    >
      {emoji}
    </span>
  )
}
