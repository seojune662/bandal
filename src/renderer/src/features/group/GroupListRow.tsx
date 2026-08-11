import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState
} from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { GroupSummary } from '../../../../shared/types/group'
import { showToast } from '../../app/toast'
import { useCoursesStore } from '../../stores/coursesStore'
import { useGroupsStore } from '../../stores/groupsStore'
import { normalizeCourseColor } from '../courses/courseColors'

interface GroupListRowProps {
  group: GroupSummary
  onOpen: (groupId: string) => void
  /** Opens the shared 함께하기 tab directly on its whiteboard view. */
  onOpenWhiteboard?: (groupId: string) => void
}

interface MenuAnchor {
  x: number
  y: number
  placement: 'top' | 'bottom'
}

type PendingAction = 'link' | 'unlink' | 'leave' | null

function enabledMenuItems(menu: HTMLElement): HTMLButtonElement[] {
  return Array.from(
    menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
  )
}

/** Shared compact row used by both course groups and the unassigned bucket. */
export function GroupListRow({
  group,
  onOpen,
  onOpenWhiteboard
}: GroupListRowProps): JSX.Element {
  const courses = useCoursesStore((state) => state.courses)
  const linkCourse = useGroupsStore((state) => state.linkCourse)
  const leaveGroup = useGroupsStore((state) => state.leaveGroup)
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null)
  const [courseListOpen, setCourseListOpen] = useState(false)
  const [leaveConfirm, setLeaveConfirm] = useState(false)
  const [pending, setPending] = useState<PendingAction>(null)
  const itemRef = useRef<HTMLLIElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const closeMenu = useCallback((): void => {
    setMenuAnchor(null)
    setCourseListOpen(false)
    setLeaveConfirm(false)
  }, [])

  useEffect(() => {
    if (menuAnchor === null) return

    menuRef.current
      ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      ?.focus()

    const closeOnPointerDown = (event: PointerEvent): void => {
      if (!itemRef.current?.contains(event.target as Node)) closeMenu()
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      closeMenu()
      triggerRef.current?.focus()
    }

    window.addEventListener('pointerdown', closeOnPointerDown)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [closeMenu, menuAnchor])

  const handleMenuKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>
  ): void => {
    if (
      event.key !== 'ArrowDown' &&
      event.key !== 'ArrowUp' &&
      event.key !== 'Home' &&
      event.key !== 'End'
    ) {
      return
    }

    const menu = menuRef.current
    if (menu === null) return
    const items = enabledMenuItems(menu)
    if (items.length === 0) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    let next = 0
    if (event.key === 'ArrowDown') {
      next = current < 0 ? 0 : (current + 1) % items.length
    }
    if (event.key === 'ArrowUp') {
      next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length
    }
    if (event.key === 'End') next = items.length - 1

    event.preventDefault()
    items[next]?.focus()
  }

  const updateCourseLink = async (courseId: string | null): Promise<void> => {
    const action: PendingAction = courseId === null ? 'unlink' : 'link'
    if (pending !== null) return
    setPending(action)
    try {
      await linkCourse(group.id, courseId)
      closeMenu()
      setPending(null)
      showToast(
        courseId === null ? '과목 연결을 해제했어요.' : '과목에 연결했어요.'
      )
    } catch (error) {
      console.error('[Bandal] 그룹의 과목 연결을 바꾸지 못했습니다.', error)
      showToast(
        courseId === null
          ? '과목 연결을 해제하지 못했어요.'
          : '과목에 연결하지 못했어요.',
        'danger'
      )
      setPending(null)
    }
  }

  const confirmLeave = async (): Promise<void> => {
    if (pending !== null) return
    setPending('leave')
    try {
      await leaveGroup(group.id)
      closeMenu()
      setPending(null)
      showToast('그룹에서 나갔어요.')
    } catch (error) {
      console.error('[Bandal] 그룹에서 나가지 못했습니다.', error)
      showToast('그룹에서 나가지 못했어요.', 'danger')
      setPending(null)
    }
  }

  return (
    <li ref={itemRef} className="group-row-item">
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
          <span>화이트보드</span>
        </button>
      )}

      <button
        ref={triggerRef}
        type="button"
        className="group-row__actions"
        aria-label={`${group.name} 관리`}
        title="그룹 관리"
        aria-haspopup="menu"
        aria-expanded={menuAnchor !== null}
        aria-controls={menuAnchor === null ? undefined : menuId}
        onClick={(event) => {
          if (menuAnchor !== null) {
            closeMenu()
            return
          }
          const rect = event.currentTarget.getBoundingClientRect()
          const placement =
            rect.bottom > window.innerHeight / 2 ? 'top' : 'bottom'
          setMenuAnchor({
            x: rect.right,
            y: placement === 'top' ? rect.top : rect.bottom,
            placement
          })
        }}
      >
        <span aria-hidden="true">⋯</span>
      </button>

      {menuAnchor !== null && (
        <div
          ref={menuRef}
          id={menuId}
          className="group-actions-menu"
          role="menu"
          aria-label={`${group.name} 관리`}
          aria-busy={pending !== null}
          data-placement={menuAnchor.placement}
          style={{ left: menuAnchor.x, top: menuAnchor.y }}
          onKeyDown={handleMenuKeyDown}
        >
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={courseListOpen}
            disabled={pending !== null}
            onClick={() => {
              setCourseListOpen((current) => !current)
              setLeaveConfirm(false)
            }}
          >
            <span>과목에 연결</span>
            <span className="group-actions-menu__chevron" aria-hidden="true">
              ›
            </span>
          </button>

          {courseListOpen && (
            <div
              className="group-actions-menu__courses"
              role="group"
              aria-label="연결할 과목"
            >
              {courses.length === 0 ? (
                <span className="group-actions-menu__empty">
                  연결할 과목이 없어요.
                </span>
              ) : (
                courses.map((course) => {
                  const linked = course.id === group.courseId
                  return (
                    <button
                      key={course.id}
                      type="button"
                      role="menuitem"
                      aria-current={linked ? 'true' : undefined}
                      disabled={linked || pending !== null}
                      onClick={() => void updateCourseLink(course.id)}
                    >
                      <span
                        className="course-dot"
                        data-course-color={normalizeCourseColor(course.color)}
                      />
                      <span className="group-actions-menu__course-name">
                        {course.name}
                      </span>
                      {linked && (
                        <span className="group-actions-menu__linked">연결됨</span>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          )}

          {group.courseId !== null && (
            <button
              type="button"
              role="menuitem"
              disabled={pending !== null}
              onClick={() => void updateCourseLink(null)}
            >
              연결 해제
            </button>
          )}

          <span className="group-actions-menu__separator" aria-hidden="true" />

          {leaveConfirm ? (
            <div
              className="group-actions-menu__confirm"
              role="group"
              aria-label="그룹 나가기 확인"
            >
              <span>정말 나갈까요?</span>
              <button
                type="button"
                role="menuitem"
                disabled={pending !== null}
                onClick={() => setLeaveConfirm(false)}
              >
                취소
              </button>
              <button
                type="button"
                className="group-actions-menu__danger"
                role="menuitem"
                disabled={pending !== null}
                onClick={() => void confirmLeave()}
              >
                {pending === 'leave' ? '나가는 중…' : '나가기'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="group-actions-menu__danger"
              role="menuitem"
              disabled={pending !== null}
              onClick={() => {
                setLeaveConfirm(true)
                setCourseListOpen(false)
              }}
            >
              그룹 나가기
            </button>
          )}
        </div>
      )}
    </li>
  )
}
