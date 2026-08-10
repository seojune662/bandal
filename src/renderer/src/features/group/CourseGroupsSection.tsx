import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { showToast, showToastWithAction } from '../../app/toast'
import { useAuthStore } from '../../stores/authStore'
import { useCoursesStore } from '../../stores/coursesStore'
import {
  selectGroupsForCourse,
  useGroupsStore
} from '../../stores/groupsStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { descriptorFor } from '../workspace/tabIdentity'
import { GroupListRow } from './GroupListRow'
import './group.css'
import './groupNavigation.css'

/** Groups and creation action belonging to the selected course. */
export function CourseGroupsSection(props: {
  courseId: string
}): JSX.Element | null {
  const { courseId } = props
  const auth = useAuthStore((state) => state.auth)
  const allGroups = useGroupsStore((state) => state.groups)
  const initGroups = useGroupsStore((state) => state.init)
  const createGroup = useGroupsStore((state) => state.createGroup)
  const leaveGroup = useGroupsStore((state) => state.leaveGroup)
  const course = useCoursesStore((state) =>
    state.courses.find((entry) => entry.id === courseId)
  )
  const openTab = useWorkspaceStore((state) => state.openTab)
  const [creating, setCreating] = useState(false)
  const signedIn = auth.phase === 'signed-in'
  const groups = useMemo(
    () => selectGroupsForCourse(allGroups, courseId),
    [allGroups, courseId]
  )

  useEffect(() => {
    if (signedIn) void initGroups()
  }, [initGroups, signedIn])

  const openGroup = useCallback(
    (groupId: string) => {
      openTab(
        descriptorFor('group-chat', { courseId, groupId, view: 'chat' })
      )
    },
    [courseId, openTab]
  )

  const openWhiteboard = useCallback(
    (groupId: string): void => {
      openTab(
        descriptorFor('group-chat', {
          courseId,
          groupId,
          view: 'whiteboard'
        })
      )
    },
    [courseId, openTab]
  )

  const createForCourse = useCallback(async () => {
    if (course === undefined || creating) return
    setCreating(true)
    try {
      const result = await createGroup({
        name: course.name,
        color: course.color,
        courseId: course.id
      })
      await navigator.clipboard.writeText(result.invite.code).catch(() => {
        // Clipboard permission can be denied; the toast still exposes the code.
      })
      openGroup(result.group.id)
      showToastWithAction(
        `코드 ${result.invite.code} 복사됐어요 · 카톡에 붙여넣으면 돼요`,
        {
          label: '되돌리기',
          run: () => {
            void leaveGroup(result.group.id)
              .then(() => showToast('그룹을 되돌렸어요.'))
              .catch(() => showToast('되돌리지 못했어요.', 'danger'))
          }
        }
      )
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : '그룹을 만들지 못했어요.',
        'danger'
      )
    } finally {
      setCreating(false)
    }
  }, [course, createGroup, creating, leaveGroup, openGroup])

  if (auth.phase === 'unconfigured') return null
  if (!signedIn && groups.length === 0) return null

  return (
    <section className="course-groups-section" aria-label="이 과목의 함께하기">
      <div className="materials-group-heading">
        <span>함께하기</span>
      </div>

      {groups.length > 0 && (
        <ul className="group-list">
          {groups.map((group) => (
            <GroupListRow
              key={group.id}
              group={group}
              onOpen={openGroup}
              onOpenWhiteboard={openWhiteboard}
            />
          ))}
        </ul>
      )}

      {signedIn && groups.length === 0 && (
        <p className="course-groups-section__empty">
          아직 함께하는 그룹이 없어요.
        </p>
      )}

      {signedIn && (
        <button
          type="button"
          className="group-create"
          disabled={creating || course === undefined}
          onClick={() => void createForCourse()}
        >
          <Icon name="plus" />
          {creating ? '그룹 만드는 중…' : '이 과목으로 그룹 만들기'}
        </button>
      )}
    </section>
  )
}
