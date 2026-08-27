import { useEffect, useRef, useState } from 'react'
import type { StudyToolId } from '../../../../shared/types/study'
import { showToast } from '../../app/toast'
import { useMaterialsStore } from '../../stores/materialsStore'
import {
  isStudyToolEnabled,
  studyToolDisabledReason
} from './studyToolAvailability'
import { StudyToolIcon, StudyToolsIcon } from './StudyToolIcons'
import {
  type PackStudyToolDefinition,
  type RunPackStudyToolInput,
  useStudyToolsStore
} from './studyToolsStore'
import './study.css'

const TREE_REFRESH_DELAY_MS = 800

interface MenuPosition {
  left: number
  top: number
}

const BUILTIN_TOOL_IDS: readonly StudyToolId[] = [
  'summary',
  'quiz',
  'flashcards',
  'mindmap',
  'structured-notes',
  'exam-predictions',
  'explain'
]

function isBuiltinToolId(id: string): id is StudyToolId {
  return BUILTIN_TOOL_IDS.includes(id as StudyToolId)
}

function outputDirectory(tool: PackStudyToolDefinition): string | null {
  return tool.outputs?.dir ?? tool.outputDir ?? tool.outputsDir ?? null
}

function followUpLabel(tool: PackStudyToolDefinition): string | null {
  return tool.followUp?.label ?? tool.followUpLabel ?? null
}

export function isPackFollowUpAvailable(
  tool: PackStudyToolDefinition,
  relPath: string | null
): boolean {
  if (relPath === null || tool.enabled === false || followUpLabel(tool) === null) {
    return false
  }
  const directory = outputDirectory(tool)
    ?.replace(/^\.\//, '')
    .replace(/\/+$/, '')
  const target = relPath.replace(/^\.\//, '')
  return (
    directory !== undefined &&
    directory.length > 0 &&
    target.startsWith(`${directory}/`)
  )
}

function ToolIcon({ id }: { id: string }): JSX.Element {
  return isBuiltinToolId(id) ? <StudyToolIcon tool={id} /> : <StudyToolsIcon />
}

export interface StudyToolMenuProps {
  courseId: string
  /** 대상 파일. null이면 과목 전체 도구만 활성화된다. */
  relPath: string | null
  selection?: string
  x: number
  y: number
  onClose: () => void
  /** Stable snapshot override used by non-interactive renderers and tests. */
  toolsOverride?: readonly PackStudyToolDefinition[]
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
  const { courseId, relPath, selection, x, y, onClose, toolsOverride } = props
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<MenuPosition>({ left: x, top: y })
  const storedTools = useStudyToolsStore((state) => state.tools)
  const tools = toolsOverride ?? storedTools
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

  const runTool = (tool: PackStudyToolDefinition, followUp = false): void => {
    const input: RunPackStudyToolInput = {
      courseId,
      tool: tool.id,
      relPath,
      ...(selection === undefined ? {} : { selection }),
      ...(followUp ? { followUpOf: tool.id } : {})
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
  const builtinTools = tools.filter((tool) => tool.source !== 'user')
  const userTools = tools.filter((tool) => tool.source === 'user')

  const renderTool = (
    tool: PackStudyToolDefinition,
    followUp: boolean
  ): JSX.Element => {
    const targetEnabled = followUp || isStudyToolEnabled(tool, relPath)
    const isRunning = (running[tool.id] ?? 0) > 0
    const disabled = !targetEnabled || isRunning
    const reason = targetEnabled
      ? isRunning
        ? '이미 만들고 있어요.'
        : null
      : studyToolDisabledReason(tool, relPath)
    const label = followUp ? (followUpLabel(tool) ?? tool.label) : tool.label
    const description = followUp
      ? '이 팩의 후속 레시피를 실행해요.'
      : tool.description

    return (
      <span
        key={`${tool.id}:${followUp ? 'follow-up' : 'primary'}`}
        className="study-tool-menu__item"
        title={reason ?? undefined}
      >
        <button
          type="button"
          role="menuitem"
          disabled={disabled}
          aria-label={reason === null ? label : `${label}: ${reason}`}
          onClick={() => runTool(tool, followUp)}
        >
          <ToolIcon id={tool.id} />
          <span className="study-tool-menu__copy">
            <strong>
              <span className="study-tool-menu__label">{label}</span>
              {tool.usesWeb === true && (
                <span
                  className="study-tool-menu__web-dot"
                  aria-label="웹 검색 사용"
                  title="웹 검색 사용"
                />
              )}
            </strong>
            <small>{reason ?? description}</small>
          </span>
        </button>
      </span>
    )
  }

  const renderGroup = (group: PackStudyToolDefinition[]): JSX.Element[] =>
    group.flatMap((tool) => [
      renderTool(tool, false),
      ...(isPackFollowUpAvailable(tool, relPath)
        ? [renderTool(tool, true)]
        : [])
    ])

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
      {renderGroup(builtinTools)}
      {userTools.length > 0 && (
        <div className="study-tool-menu__heading study-tool-menu__heading--separator">
          설치한 팩
        </div>
      )}
      {renderGroup(userTools)}
      {emptyMessage !== null && (
        <p className="study-tool-menu__empty" role="status">
          {emptyMessage}
        </p>
      )}
    </div>
  )
}
