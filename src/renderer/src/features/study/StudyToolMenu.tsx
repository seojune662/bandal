import { useEffect, useRef, useState } from 'react'
import type {
  RunStudyToolInput,
  StudyToolDefinition
} from '../../../../shared/types/study'
import { showToast } from '../../app/toast'
import { useMaterialsStore } from '../../stores/materialsStore'
import {
  isStudyToolEnabled,
  studyToolDisabledReason
} from './studyToolAvailability'
import { StudyToolIcon } from './StudyToolIcons'
import { useStudyToolsStore } from './studyToolsStore'
import './study.css'

const TREE_REFRESH_DELAY_MS = 800

interface MenuPosition {
  left: number
  top: number
}

export interface StudyToolMenuProps {
  courseId: string
  /** 대상 파일. null이면 과목 전체 도구만 활성화된다. */
  relPath: string | null
  selection?: string
  x: number
  y: number
  onClose: () => void
}

function enabledMenuItems(menu: HTMLElement): HTMLButtonElement[] {
  return Array.from(
    menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
  )
}

function statusMessage(
  isLoading: boolean,
  hasLoaded: boolean,
  error: string | null
): string | null {
  if (isLoading) return 'AI 학습 도구를 불러오는 중이에요.'
  if (error !== null) return error
  if (!hasLoaded) return 'AI 학습 도구를 불러오는 중이에요.'
  return '사용 가능한 AI 학습 도구가 없어요.'
}

export function StudyToolMenu(props: StudyToolMenuProps): JSX.Element {
  const { courseId, relPath, selection, x, y, onClose } = props
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<MenuPosition>({ left: x, top: y })
  const tools = useStudyToolsStore((state) => state.tools)
  const hasLoaded = useStudyToolsStore((state) => state.hasLoaded)
  const isLoading = useStudyToolsStore((state) => state.isLoading)
  const error = useStudyToolsStore((state) => state.error)
  const running = useStudyToolsStore((state) => state.running)
  const loadTools = useStudyToolsStore((state) => state.loadTools)
  const run = useStudyToolsStore((state) => state.run)

  useEffect(() => {
    void loadTools()
  }, [loadTools])

  useEffect(() => {
    const placeInsideViewport = (): void => {
      const menu = menuRef.current
      if (menu === null) return
      const { width, height } = menu.getBoundingClientRect()
      const flippedLeft = x + width > window.innerWidth ? x - width : x
      const flippedTop = y + height > window.innerHeight ? y - height : y
      setPosition({
        left: Math.min(
          Math.max(0, flippedLeft),
          Math.max(0, window.innerWidth - width)
        ),
        top: Math.min(
          Math.max(0, flippedTop),
          Math.max(0, window.innerHeight - height)
        )
      })
    }

    placeInsideViewport()
    window.addEventListener('resize', placeInsideViewport)
    return () => window.removeEventListener('resize', placeInsideViewport)
  }, [error, hasLoaded, isLoading, tools.length, x, y])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const menu = menuRef.current
      if (menu === null) return
      const firstItem = enabledMenuItems(menu)[0]
      if (firstItem === undefined) menu.focus()
      else firstItem.focus()
    })
    const dismissOnPointerDown = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    const dismissOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', dismissOnPointerDown)
    window.addEventListener('keydown', dismissOnEscape)
    window.addEventListener('blur', onClose)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('pointerdown', dismissOnPointerDown)
      window.removeEventListener('keydown', dismissOnEscape)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    const menu = menuRef.current
    if (menu === null) return
    const items = enabledMenuItems(menu)
    if (items.length === 0) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    let next: number | null = null

    if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length
    if (event.key === 'ArrowUp') {
      next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length
    }
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = items.length - 1
    if (event.key === 'Tab') {
      next = event.shiftKey
        ? current <= 0
          ? items.length - 1
          : current - 1
        : current >= items.length - 1
          ? 0
          : current + 1
    }
    if (next === null) return
    event.preventDefault()
    items[next]?.focus()
  }

  const runTool = (tool: StudyToolDefinition): void => {
    const input: RunStudyToolInput = {
      courseId,
      tool: tool.id,
      relPath,
      ...(selection === undefined ? {} : { selection })
    }

    void run(input)
      .then((result) => {
        showToast(`AI 학습 자료를 만들었어요: ${result.relPath}`)
        window.setTimeout(() => {
          void useMaterialsStore.getState().loadTree(courseId)
        }, TREE_REFRESH_DELAY_MS)
      })
      .catch(() => {
        showToast('AI 학습 자료를 만들지 못했어요.', 'danger')
      })

    showToast('AI가 만드는 중이에요. 자료에 곧 나타납니다.')
    onClose()
  }

  const emptyMessage =
    tools.length === 0 ? statusMessage(isLoading, hasLoaded, error) : null

  return (
    <div
      ref={menuRef}
      className="context-menu study-tool-menu"
      role="menu"
      aria-label="AI 학습 도구"
      tabIndex={-1}
      style={{ left: position.left, top: position.top }}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="study-tool-menu__heading">AI 학습 도구</div>
      {tools.map((tool) => {
        const targetEnabled = isStudyToolEnabled(tool, relPath)
        const isRunning = (running[tool.id] ?? 0) > 0
        const disabled = !targetEnabled || isRunning
        const reason = targetEnabled
          ? isRunning
            ? '이미 만들고 있어요.'
            : null
          : studyToolDisabledReason(tool, relPath)

        return (
          <span
            key={tool.id}
            className="study-tool-menu__item"
            title={reason ?? undefined}
          >
            <button
              type="button"
              role="menuitem"
              disabled={disabled}
              aria-label={reason === null ? tool.label : `${tool.label}: ${reason}`}
              onClick={() => runTool(tool)}
            >
              <StudyToolIcon tool={tool.id} />
              <span className="study-tool-menu__copy">
                <strong>{tool.label}</strong>
                <small>{reason ?? tool.description}</small>
              </span>
            </button>
          </span>
        )
      })}
      {emptyMessage !== null && (
        <p className="study-tool-menu__empty" role="status">
          {emptyMessage}
        </p>
      )}
    </div>
  )
}
