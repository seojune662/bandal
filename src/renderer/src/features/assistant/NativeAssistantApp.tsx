import { useEffect, useState } from 'react'
import { AssistantPopup } from './AssistantPopup'
import { invoke, onPush } from '../../lib/ipc'
import { useCoursesStore } from '../../stores/coursesStore'
import { requestChatPrompt } from '../chat/chatPromptBus'
import type { AssistantWindowState } from '../../../../shared/types/assistantWindow'
import './assistant.css'

export function NativeAssistantApp(): JSX.Element {
  const [state, setState] = useState<AssistantWindowState>({ visible: false, courseId: null, conversationId: null })
  useEffect(() => {
    const accept = (next: AssistantWindowState): void => { useCoursesStore.setState({ selectedCourseId: next.courseId }); setState(next) }
    const off = onPush('assistant:state', accept)
    const prompt = onPush('assistant:prompt', event => requestChatPrompt(event.conversationId, event.prompt))
    void invoke('assistant:window', { action: 'get' }).then(accept)
    return () => { off(); prompt() }
  }, [])
  return <div className="assistant-layer assistant-native">
    <AssistantPopup native visible={state.visible} conversationId={state.conversationId}
      onClose={() => { void invoke('assistant:window', { action: 'close' }) }}
      onOpenConversation={conversationId => {
        if (state.courseId) void invoke('overlay:setConversation', { courseId: state.courseId, conversationId })
      }} />
  </div>
}
