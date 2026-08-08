import { useEffect, useState } from 'react'
import type { StudyGap } from '../../../../shared/types/search'
import { invoke } from '../../lib/ipc'
import { kindForMaterialName } from '../materials/materialPaths'
import { openMaterialInCourse } from '../workspace/openMaterial'
import './insights.css'

export function StudyGapList(props: {
  courseId: string
}): JSX.Element | null {
  const [gaps, setGaps] = useState<StudyGap[] | null>(null)

  useEffect(() => {
    let active = true
    setGaps(null)
    void invoke('insights:gaps', { courseId: props.courseId })
      .then((result) => {
        if (active) setGaps(result.gaps)
      })
      .catch(() => {
        if (active) setGaps([])
      })
    return () => {
      active = false
    }
  }, [props.courseId])

  if (gaps === null || gaps.length === 0) return null

  return (
    <section className="study-gap-list" aria-label="놓친 것 알려주기">
      <h3 className="study-gap-list__heading">놓친 것 알려주기</h3>
      <ul className="study-gap-list__items">
        {gaps.map((gap) => {
          const relPath = gap.relPath
          const key = `${gap.kind}:${relPath ?? ''}:${gap.message}`
          return (
            <li key={key} className="study-gap-list__item" data-kind={gap.kind}>
              {relPath === null ? (
                <p className="study-gap-list__message">{gap.message}</p>
              ) : (
                <button
                  type="button"
                  className="study-gap-list__button"
                  title={relPath}
                  onClick={() => {
                    const kind = kindForMaterialName(relPath)
                    openMaterialInCourse(props.courseId, kind, relPath)
                  }}
                >
                  {gap.message}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
