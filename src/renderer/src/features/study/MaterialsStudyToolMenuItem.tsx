import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MaterialNode } from '../../../../shared/types/materials'
import { useMaterialsStore } from '../../stores/materialsStore'
import { StudyToolMenu } from './StudyToolMenu'
import { StudyToolsIcon, SubmenuChevronIcon } from './StudyToolIcons'

interface MaterialsStudyToolMenuItemProps {
  target: MaterialNode | null
  x: number
  y: number
  onClose: () => void
}

interface MenuAnchor {
  x: number
  y: number
}

export function MaterialsStudyToolMenuItem({
  target,
  x,
  y,
  onClose
}: MaterialsStudyToolMenuItemProps): JSX.Element | null {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)
  const courseId = useMaterialsStore((state) => state.activeCourseId)

  if (target?.kind === 'dir') return null

  const openStudyTools = (): void => {
    const bounds = buttonRef.current?.getBoundingClientRect()
    setAnchor({
      x: bounds?.right ?? x,
      y: bounds?.top ?? y
    })
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        disabled={courseId === null}
        title={courseId === null ? '먼저 과목을 선택하세요.' : undefined}
        onClick={openStudyTools}
      >
        <StudyToolsIcon />
        <span className="study-tool-menu-trigger__label">AI 학습 도구</span>
        <span className="study-tool-menu-trigger__chevron">
          <SubmenuChevronIcon />
        </span>
      </button>
      {anchor !== null &&
        courseId !== null &&
        createPortal(
          <StudyToolMenu
            courseId={courseId}
            relPath={target?.relPath ?? null}
            x={anchor.x}
            y={anchor.y}
            onClose={() => {
              setAnchor(null)
              onClose()
            }}
          />,
          document.body
        )}
    </>
  )
}
