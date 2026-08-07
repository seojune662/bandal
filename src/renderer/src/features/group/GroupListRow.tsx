import type { GroupSummary } from '../../../../shared/types/group'
import { normalizeCourseColor } from '../courses/courseColors'

interface GroupListRowProps {
  group: GroupSummary
  onOpen: (groupId: string) => void
  /** Opens the shared 함께하기 tab directly on its whiteboard view. */
  onOpenWhiteboard?: (groupId: string) => void
}

/** Shared compact row used by both course groups and the unassigned bucket. */
export function GroupListRow({
  group,
  onOpen,
  onOpenWhiteboard
}: GroupListRowProps): JSX.Element {
  return (
    <li className="group-row-item">
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
      {onOpenWhiteboard !== undefined && (
        <button
          type="button"
          className="group-row__board"
          aria-label={`${group.name} 화이트보드 열기`}
          title="화이트보드"
          onClick={() => onOpenWhiteboard(group.id)}
        >
          <svg
            viewBox="0 0 24 24"
            width="1em"
            height="1em"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="13" rx="2" />
            <path d="M12 17v3" />
            <path d="M7 12c1.6-3.4 3-3.4 4.4 0 1.3 3.2 2.6 3.2 4-.6" />
          </svg>
        </button>
      )}
    </li>
  )
}
