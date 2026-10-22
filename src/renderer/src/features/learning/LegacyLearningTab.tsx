import { useEffect } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import { isTabDescriptor } from '../../../../shared/tabs'
import { openLearning, openLearningHome } from './learningNavigation'

/** Old favorites and extension links remain navigable after the layout upgrade. */
export default function LegacyLearningTab(props: IDockviewPanelProps): JSX.Element {
  useEffect(() => {
    const descriptor = props.params.descriptor
    if (!isTabDescriptor(descriptor) || descriptor.kind !== 'learning') return
    const payload = descriptor.payload
    props.api.close()
    if (payload.rootRelPath === undefined) openLearningHome()
    else openLearning({ courseId: payload.courseId, rootRelPath: payload.rootRelPath }, payload.view, payload.itemId)
  }, [props.api])
  return <div className="workspace-panel-loading" role="status">프로젝트 여는 중…</div>
}
