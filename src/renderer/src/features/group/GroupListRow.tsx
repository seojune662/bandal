import type { GroupSummary } from '../../../../shared/types/group'
import { normalizeCourseColor } from '../courses/courseColors'

interface GroupListRowProps {
  group: GroupSummary
  onOpen: (groupId: string) => void
}

/** Shared compact row used by both course groups and the unassigned bucket. */
export function GroupListRow({
  group,
  onOpen
}: GroupListRowProps): JSX.Element {
  return (
    <li>
      <button
        type="button"
        className="group-row"
        onClick={() => onOpen(group.id)}
      >
        <span
          className="course-dot"
          data-course-color={normalizeCourseColor(group.color)}
        />
        <span className="group-row__name">{group.name}</span>
        {group.unread > 0 && (
          <span
            className="group-row__badge"
            aria-label={`읽지 않은 메시지 ${group.unread}개`}
          >
            {group.unread > 99 ? '99+' : group.unread}
          </span>
        )}
      </button>
    </li>
  )
}
