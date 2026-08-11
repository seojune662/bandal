import { create } from 'zustand'
import {
  TUTORIAL_VERSION,
  type Settings
} from '../../../../../shared/types/settings'
import { showToast } from '../../../app/toast'
import { invoke, onPush } from '../../../lib/ipc'
import { useCoursesStore } from '../../../stores/coursesStore'
import { useUiStore } from '../../../stores/uiStore'
import { useWorkspaceStore } from '../../../stores/workspaceStore'
import { COURSE_COLORS } from '../../courses/courseColors'
import { descriptorFor } from '../../workspace/tabIdentity'
import { shouldShowOnboarding } from '../onboardingModel'
import { TOUR_STEP_COUNT, TOUR_STEPS } from './tourScript'
import type { TourBeforeAction } from './tourTypes'

export type TourStatus =
  | 'idle'
  | 'offer'
  | 'acknowledging'
  | 'starting'
  | 'running'
  | 'cleaning'

interface TourStore {
  status: TourStatus
  stepIndex: number
  courseId: string | null
  seedNotePath: string | null
  assistantConversationId: string | null
  transitioning: boolean
  init: () => Promise<void>
  start: () => Promise<void>
  later: () => Promise<void>
  next: () => void
  back: () => void
  skip: () => void
  finish: () => void
}

const TOUR_COURSE_NAME = '반달 튜토리얼'
const SEED_NOTE_NAME = '환영해요.md'
const SEED_NOTE = `# 반달에 오신 걸 환영해요

이 노트는 둘러보기를 위해 만든 임시 자료예요.

- 과목마다 자료와 필기를 한 폴더에 모을 수 있어요.
- PDF, 브라우저, AI 튜터를 탭으로 함께 열 수 있어요.
- 둘러보기를 마치거나 건너뛰면 이 과목과 노트는 자동으로 정리돼요.
`

let initialized = false

function tutorialSettings(courseId: string | null): Settings['tutorial'] {
  return { seenVersion: TUTORIAL_VERSION, activeCourseId: courseId }
}

function chooseTourColor(): string {
  const courses = useCoursesStore.getState().courses
  const used = new Set(courses.map((course) => course.color))
  const unused = COURSE_COLORS.find((color) => !used.has(color))
  if (unused !== undefined) return unused
  return COURSE_COLORS[courses.length % COURSE_COLORS.length] ?? COURSE_COLORS[0]
}

function descriptorCourseId(
  descriptor: ReturnType<typeof descriptorFor>
): string | null {
  return 'courseId' in descriptor.payload &&
    typeof descriptor.payload.courseId === 'string'
    ? descriptor.payload.courseId
    : null
}

function closeCourseTabs(courseId: string): void {
  const workspace = useWorkspaceStore.getState()
  for (const [panelId, descriptor] of Object.entries(workspace.openTabs)) {
    if (descriptorCourseId(descriptor) === courseId) workspace.closeTab(panelId)
  }
}

function revealTourSurfaces(): void {
  const ui = useUiStore.getState()
  ui.closeSettings()
  ui.closeBoardOverlay()
  if (!ui.leftRailOpen) ui.toggleLeftRail()
  if (!ui.rightRailOpen) ui.toggleRightRail()
}

function unknownCourse(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.toLowerCase().includes('unknown course')
}

async function waitForWorkspaceCourse(
  courseId: string,
  timeoutMs = 3_000
): Promise<void> {
  const ready = (): boolean => {
    const state = useWorkspaceStore.getState()
    return state.activeCourseId === courseId && state.hydration === 'ready'
  }
  if (ready()) return

  await new Promise<void>((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      unsubscribe()
      resolve()
    }
    const unsubscribe = useWorkspaceStore.subscribe(() => {
      if (ready()) finish()
    })
    const timeout = setTimeout(finish, timeoutMs)
  })
}

async function waitForPaint(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
}

async function revealFavorites(courseId: string): Promise<void> {
  const ui = useUiStore.getState()
  if (!ui.leftRailOpen) ui.toggleLeftRail()
  useCoursesStore.getState().selectCourse(courseId)
  await waitForWorkspaceCourse(courseId)

  // Let the rail mount and the selected course render before checking the
  // local collapse state owned by CourseSidebar.
  await waitForPaint()
  await waitForPaint()
  const toggle = document.querySelector<HTMLButtonElement>(
    '.course-row[data-selected="true"] .course-row__toggle'
  )
  if (toggle?.getAttribute('aria-expanded') === 'false') {
    toggle.click()
    await waitForPaint()
  }
}

async function prepareStep(
  action: TourBeforeAction | null,
  courseId: string,
  seedNotePath: string,
  assistantConversationId: string
): Promise<void> {
  if (action === null) return

  if (action === 'reveal-favorites') {
    await revealFavorites(courseId)
    return
  }

  useCoursesStore.getState().selectCourse(courseId)
  await waitForWorkspaceCourse(courseId)

  if (action === 'open-seed-note') {
    useWorkspaceStore
      .getState()
      .openTab(descriptorFor('note', { courseId, relPath: seedNotePath }))
    return
  }

  useWorkspaceStore.getState().openTab(
    descriptorFor('chat', {
      courseId,
      conversationId: assistantConversationId
    })
  )
}

/**
 * One cleanup path for finish, skip, failed starts and boot-time leak repair.
 * The marker is cleared only after both the soft delete and guarded purge have
 * completed, so a transient failure remains repairable on the next boot.
 */
async function cleanupCourse(
  courseId: string,
  clearMarker: boolean
): Promise<void> {
  closeCourseTabs(courseId)

  try {
    await useCoursesStore.getState().loadCourses()
  } catch (error) {
    console.error('[Bandal] 튜토리얼 정리 전 과목 목록을 불러오지 못했습니다.', error)
  }

  const coursesState = useCoursesStore.getState()
  const otherCourse = coursesState.courses.find(
    (course) => course.id !== courseId
  )
  if (otherCourse !== undefined) {
    coursesState.selectCourse(otherCourse.id)
    useWorkspaceStore.getState().setActiveCourse(otherCourse.id)
  }

  let liveCourseExists = coursesState.courses.some(
    (course) => course.id === courseId
  )
  if (!liveCourseExists) {
    try {
      const liveCourses = await invoke('courses:list', {})
      liveCourseExists = liveCourses.some((course) => course.id === courseId)
    } catch (error) {
      console.error('[Bandal] 남은 튜토리얼 과목을 확인하지 못했습니다.', error)
    }
  }

  if (liveCourseExists) {
    await useCoursesStore.getState().deleteCourse(courseId)
  }

  if (otherCourse === undefined) {
    useWorkspaceStore.getState().setActiveCourse(null)
  } else {
    useWorkspaceStore.getState().setActiveCourse(otherCourse.id)
  }

  try {
    await invoke('courses:purge', { courseId })
  } catch (error) {
    // A completed purge followed by a settings write crash leaves only the
    // marker. Treat that exact recovery case as already clean.
    if (!unknownCourse(error)) throw error
  }

  if (clearMarker) {
    await invoke('settings:set', { tutorial: tutorialSettings(null) })
  }
}

export const useTourStore = create<TourStore>()((set, get) => {
  const enterStep = async (stepIndex: number): Promise<void> => {
    const state = get()
    if (
      state.status !== 'running' ||
      state.transitioning ||
      state.courseId === null ||
      state.seedNotePath === null ||
      state.assistantConversationId === null
    ) {
      return
    }
    const step = TOUR_STEPS[stepIndex]
    if (step === undefined) return

    set({ transitioning: true })
    try {
      await prepareStep(
        step.before,
        state.courseId,
        state.seedNotePath,
        state.assistantConversationId
      )
    } catch (error) {
      // Step setup is presentational. A missing/failed surface must never
      // make the narration impossible to finish.
      console.error('[Bandal] 튜토리얼 화면을 준비하지 못했습니다.', error)
    }
    if (get().status === 'running') {
      set({ stepIndex, transitioning: false })
    }
  }

  const endTour = async (): Promise<void> => {
    const state = get()
    if (state.status !== 'running' || state.courseId === null) return
    set({ status: 'cleaning', transitioning: false })
    try {
      await cleanupCourse(state.courseId, true)
      set({
        status: 'idle',
        stepIndex: 0,
        courseId: null,
        seedNotePath: null,
        assistantConversationId: null
      })
    } catch (error) {
      console.error('[Bandal] 튜토리얼 임시 과목을 정리하지 못했습니다.', error)
      showToast(
        '임시 과목을 정리하지 못했어요. 다시 한 번 끝내기를 눌러주세요.',
        'danger'
      )
      set({ status: 'running' })
    }
  }

  return {
    status: 'idle',
    stepIndex: 0,
    courseId: null,
    seedNotePath: null,
    assistantConversationId: null,
    transitioning: false,

    init: async () => {
      if (initialized) return
      initialized = true

      onPush('settings:changed', ({ settings }) => {
        if (
          get().status === 'idle' &&
          settings.tutorial.activeCourseId === null &&
          settings.tutorial.seenVersion < TUTORIAL_VERSION &&
          !shouldShowOnboarding(settings.onboarding)
        ) {
          void get().start()
        }
      })

      try {
        const settings = await invoke('settings:get', {})
        const leakedCourseId = settings.tutorial.activeCourseId
        if (leakedCourseId !== null) {
          try {
            await cleanupCourse(leakedCourseId, true)
          } catch (error) {
            // Boot repair is intentionally quiet. Keeping the marker intact
            // makes the next boot another safe retry.
            console.error('[Bandal] 남은 튜토리얼 과목을 복구하지 못했습니다.', error)
          }
          return
        }

        if (
          settings.tutorial.seenVersion < TUTORIAL_VERSION &&
          !shouldShowOnboarding(settings.onboarding)
        ) {
          set({ status: 'offer' })
        }
      } catch (error) {
        console.error('[Bandal] 튜토리얼 설정을 불러오지 못했습니다.', error)
      }
    },

    start: async () => {
      const previousStatus = get().status
      if (previousStatus !== 'idle' && previousStatus !== 'offer') return
      set({ status: 'starting', transitioning: false })

      let createdCourseId: string | null = null
      let markerWritten = false
      try {
        const settings = await invoke('settings:get', {})
        if (settings.dataRoot.trim().length === 0) {
          showToast('과목 저장 위치를 먼저 설정해주세요.', 'danger')
          set({ status: previousStatus })
          return
        }

        revealTourSurfaces()

        const course = await useCoursesStore.getState().createCourse({
          name: TOUR_COURSE_NAME,
          color: chooseTourColor()
        })
        createdCourseId = course.id

        await invoke('settings:set', {
          tutorial: tutorialSettings(course.id)
        })
        markerWritten = true

        const seed = await invoke('materials:writeFile', {
          courseId: course.id,
          dirRelPath: '',
          fileName: SEED_NOTE_NAME,
          encoding: 'utf8',
          data: SEED_NOTE
        })
        const assistantConversationId = crypto.randomUUID()

        useCoursesStore.getState().selectCourse(course.id)
        await waitForWorkspaceCourse(course.id)
        useWorkspaceStore.getState().openTab(
          descriptorFor('note', {
            courseId: course.id,
            relPath: seed.relPath
          })
        )

        set({
          status: 'running',
          stepIndex: 0,
          courseId: course.id,
          seedNotePath: seed.relPath,
          assistantConversationId,
          transitioning: false
        })
      } catch (error) {
        console.error('[Bandal] 튜토리얼을 시작하지 못했습니다.', error)
        if (createdCourseId !== null) {
          try {
            await cleanupCourse(createdCourseId, markerWritten)
          } catch (cleanupError) {
            console.error(
              '[Bandal] 시작에 실패한 튜토리얼 과목을 정리하지 못했습니다.',
              cleanupError
            )
          }
        }
        showToast('둘러보기를 시작하지 못했어요. 잠시 후 다시 시도해주세요.', 'danger')
        set({
          status: 'idle',
          stepIndex: 0,
          courseId: null,
          seedNotePath: null,
          assistantConversationId: null,
          transitioning: false
        })
      }
    },

    later: async () => {
      const status = get().status
      if (status !== 'idle' && status !== 'offer') return
      set({ status: 'acknowledging' })
      try {
        await invoke('settings:set', { tutorial: tutorialSettings(null) })
        set({ status: 'idle' })
      } catch (error) {
        console.error('[Bandal] 튜토리얼 제안 상태를 저장하지 못했습니다.', error)
        showToast('둘러보기 선택을 저장하지 못했어요.', 'danger')
        set({ status })
      }
    },

    next: () => {
      const state = get()
      if (state.status !== 'running' || state.transitioning) return
      const nextIndex = state.stepIndex + 1
      if (nextIndex >= TOUR_STEP_COUNT) {
        void endTour()
      } else {
        void enterStep(nextIndex)
      }
    },

    back: () => {
      const state = get()
      if (
        state.status !== 'running' ||
        state.transitioning ||
        state.stepIndex <= 0
      ) {
        return
      }
      void enterStep(state.stepIndex - 1)
    },

    skip: () => {
      void endTour()
    },

    finish: () => {
      void endTour()
    }
  }
})
