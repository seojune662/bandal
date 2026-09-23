import { taskCalendarInterval } from '../src/shared/taskSchedule'
import { localDateValue } from '../src/renderer/src/features/calendar/calendarDate'
import type { IpcChannel, IpcRequest, IpcResponse } from '../src/shared/ipc/contract'
import type { PushChannel, PushPayload } from '../src/shared/ipc/events'
import type { IpcAdapter } from '../src/renderer/src/lib/ipc'
import type { ChatMessage } from '../src/shared/types/chat'
import { data, commit, settings, stamp, id, key, ko, PDF, NOTE, courseId } from './state'

type Handlers = { [K in IpcChannel]?: (req: IpcRequest<K>) => IpcResponse<K> | Promise<IpcResponse<K>> }
const listeners = new Map<string, Set<(value: never) => void>>()
export function emit<K extends PushChannel>(channel: K, value: PushPayload<K>): void {
  for (const callback of listeners.get(channel) ?? []) callback(structuredClone(value) as never)
}
const ok = { ok: true } as const
const materialChanged = (course: string) => emit('materials:changed', { courseId: course })
function readNote(course: string, path: string) {
  const note = data.notes[key(course, path)]
  if (!note) throw new Error(ko ? '필기를 찾을 수 없습니다.' : 'Note not found.')
  return structuredClone(note)
}
function nodeList(course: string) {
  return [{ relPath: PDF, name: PDF, kind: 'pdf' as const, size: 36000, mtime: Date.now() },
    ...Object.values(data.notes).filter(note => note.courseId === course).map(note => ({ relPath: note.relPath, name: note.relPath, kind: 'note' as const, size: note.markdown.length, mtime: note.mtime }))]
}
function writeNote(course: string, path: string, markdown: string) {
  const note = { courseId: course, relPath: path, markdown, mtime: Math.max(Date.now(), (data.notes[key(course, path)]?.mtime ?? 0) + 1) }
  commit(next => { next.notes[key(course, path)] = note })
  materialChanged(course)
  return structuredClone(note)
}
function unusedName(course: string, name: string): string {
  const cleaned = name.replace(/[\\/]/g, '-').trim().slice(0, 180) || '새 필기'
  const stem = cleaned.replace(/\.md$/i, '')
  let path = `${stem}.md`, i = 2
  while (data.notes[key(course, path)]) path = `${stem} ${i++}.md`
  return path
}
function session(course: string, sessionId: string) {
  if (!data.chats[sessionId]) commit(next => { next.chats[sessionId] = { session: { id: sessionId, courseId: course, surface: 'app', provider: settings.agentProvider, cliSessionId: null, model: 'sonnet', effort: 'high', status: 'idle', lastUsedAt: stamp(), title: ko ? '해시 충돌 복습 · 예시' : 'Hash collisions · example' }, messages: [] } })
  return data.chats[sessionId]!
}
const answer = ko ? '이 대화는 **웹 체험용 예시**입니다. 실제 AI 요청이나 도구 실행은 일어나지 않아요.\n\n### 체이닝\n같은 버킷에 여러 값을 연결해서 저장합니다. 충돌이 생기면 해당 버킷의 목록을 탐색해요.\n\n### 개방 주소법\n배열 안에서 다른 빈 공간을 찾습니다. 적재율이 높아질수록 탐색할 칸이 늘어날 수 있어요.\n\n**복습해 볼 질문**\n\n- 두 방법의 저장 위치는 어떻게 다를까요?\n- 적재율이 높아지면 탐색 비용은 어떻게 될까요?\n- 키를 삭제할 때는 무엇을 주의해야 할까요?' : 'This is a **scripted web demo**, not a live AI response. No tools are executed.\n\n### Chaining\nKeep multiple entries in the same bucket.\n\n### Open addressing\nFind another empty slot within the array.\n\nTry changing the model and effort, adding material, and sending another example question.'
function message(course: string, sessionId: string, role: 'user' | 'assistant', text: string): ChatMessage {
  const messageId = id()
  return { id: messageId, courseId: course, sessionId, role, turnSeq: Math.floor(session(course, sessionId).messages.length / 2) + 1, createdAt: stamp(), blocks: [{ id: id(), messageId, ord: 0, kind: 'text', payload: { text } }] }
}
const pending = new Map<string, ReturnType<typeof setTimeout>>()
let sequence = 0
const handlers: Handlers = {
  'settings:get': () => structuredClone(settings),
  'settings:set': patch => {
    Object.assign(settings, patch)
    emit('settings:changed', { settings })
    if (patch.theme || patch.palette) window.parent.postMessage({ type: 'bandal-demo-appearance', palette: settings.palette, theme: settings.theme }, location.origin)
    return structuredClone(settings)
  },
  'courses:list': ({ includeArchived }) => data.courses.filter(c => includeArchived || !c.archived),
  'courses:create': input => {
    const course = { ...data.courses[0]!, ...input, id: id(), slug: id(), sortOrder: data.courses.length, createdAt: stamp(), updatedAt: stamp() }
    commit(next => { next.courses.push(course) })
    return course
  },
  'courses:rename': ({ courseId, name }) => { commit(next => { const c = next.courses.find(c => c.id === courseId)!; c.name = name }); return data.courses.find(c => c.id === courseId)! },
  'courses:setColor': ({ courseId, color }) => { commit(next => { next.courses.find(c => c.id === courseId)!.color = color }); return data.courses.find(c => c.id === courseId)! },
  'courses:archive': ({ courseId, archived }) => { commit(next => { next.courses.find(c => c.id === courseId)!.archived = archived }); return data.courses.find(c => c.id === courseId)! },
  'courseGroups:list': () => [],
  'courseLinks:list': () => [],
  'layout:get': ({ courseId }) => ({ layout: data.layouts[courseId] ?? null }),
  'layout:save': ({ courseId, layout }) => { commit(next => { next.layouts[courseId] = layout }); return ok },
  'materials:tree': ({ courseId }) => nodeList(courseId),
  'materials:search': ({ courseId, query }) => nodeList(courseId).filter(n => n.name.toLowerCase().includes(query.toLowerCase())).map(n => ({ ...n, score: 1 })),
  'materials:watch': () => ok,
  'materials:unwatch': () => ok,
  'materials:readFile': ({ courseId, relPath }) => ({ encoding: 'utf8', data: readNote(courseId, relPath).markdown }),
  'materials:delete': ({ courseId, relPath }) => { commit(next => { delete next.notes[key(courseId, relPath)] }); materialChanged(courseId); return ok },
  'materials:duplicate': ({ courseId, relPath }) => { const path = unusedName(courseId, relPath.replace(/\.md$/, ' 복사본')); writeNote(courseId, path, readNote(courseId, relPath).markdown); return { relPath: path } },
  'notes:read': ({ courseId, relPath }) => readNote(courseId, relPath),
  'notes:write': ({ courseId, relPath, markdown, expectedMtime }) => {
    if (expectedMtime !== undefined && expectedMtime !== data.notes[key(courseId, relPath)]?.mtime) throw new Error('필기가 다른 곳에서 변경되었습니다. 새로 불러온 뒤 다시 저장해주세요.')
    return writeNote(courseId, relPath, markdown)
  },
  'notes:create': ({ courseId, title }) => writeNote(courseId, unusedName(courseId, title), `# ${title}\n\n`),
  'notes:rename': ({ courseId, relPath, newName }) => {
    const nextPath = unusedName(courseId, newName)
    const note = readNote(courseId, relPath)
    commit(next => {
      delete next.notes[key(courseId, relPath)]
      next.notes[key(courseId, nextPath)] = { ...note, relPath: nextPath, mtime: Date.now() }
      if (relPath === (next.primaryNotePath ?? NOTE)) next.primaryNotePath = nextPath
      for (const link of next.links) for (const endpoint of [link.source, link.target]) {
        if (endpoint.kind === 'note' && endpoint.payload.courseId === courseId && endpoint.payload.relPath === relPath) endpoint.payload.relPath = nextPath
      }
    })
    materialChanged(courseId)
    return { relPath: nextPath, mtime: data.notes[key(courseId, nextPath)]!.mtime, title: newName.replace(/\.md$/, ''), markdown: note.markdown }
  },
  'pdf:getViewState': ({ courseId, relPath }) => data.views[key(courseId, relPath)] ?? null,
  'pdf:setViewState': req => { const view = { ...req, updatedAt: stamp() }; commit(next => { next.views[key(req.courseId, req.relPath)] = view }); return view },
  'annotations:listForFile': ({ courseId, relPath }) => data.annotations.filter(a => a.courseId === courseId && a.relPath === relPath),
  'annotations:create': input => { const entry = { ...input, id: id(), comment: input.comment ?? null, createdAt: stamp(), updatedAt: stamp() }; commit(next => { next.annotations.push(entry) }); return entry },
  'annotations:update': input => { commit(next => { Object.assign(next.annotations.find(a => a.id === input.id)!, input, { updatedAt: stamp() }) }); return data.annotations.find(a => a.id === input.id)! },
  'annotations:delete': ({ id }) => { commit(next => { next.annotations = next.annotations.filter(a => a.id !== id) }); return ok },
  'drawings:listForFile': ({ courseId, relPath }) => data.drawings.filter(a => a.courseId === courseId && a.relPath === relPath),
  'drawings:create': input => { const entry = { ...input, id: id(), createdAt: stamp(), updatedAt: stamp() }; commit(next => { next.drawings.push(entry) }); return entry },
  'drawings:update': input => { commit(next => { Object.assign(next.drawings.find(a => a.id === input.id)!, input, { updatedAt: stamp() }) }); return data.drawings.find(a => a.id === input.id)! },
  'drawings:delete': ({ ids }) => { commit(next => { next.drawings = next.drawings.filter(a => !ids.includes(a.id)) }); return ok },
  'links:listFor': ({ courseId, relPath }) => ({ outgoing: data.links.filter(l => l.courseId === courseId && 'relPath' in l.source.payload && l.source.payload.relPath === relPath), incoming: data.links.filter(l => l.courseId === courseId && 'relPath' in l.target.payload && l.target.payload.relPath === relPath) }),
  'links:listForDescriptor': ({ courseId, descriptor }) => ({ outgoing: data.links.filter(l => l.courseId === courseId && JSON.stringify(l.source) === JSON.stringify(descriptor)), incoming: data.links.filter(l => l.courseId === courseId && JSON.stringify(l.target) === JSON.stringify(descriptor)) }),
  'links:forMaterial': () => ({ notes: [], boards: [] }),
  'links:graph': ({ courseId }) => ({ links: data.links.filter(l => l.courseId === courseId), backlinks: [] }),
  'links:create': input => { const link = { ...input, id: id(), kind: input.kind ?? 'related' as const, label: input.label ?? '', metadata: input.metadata ?? null, createdAt: stamp() }; commit(next => { next.links.push(link) }); return link },
  'links:updatePageNote': ({ id, metadata }) => { commit(next => { next.links.find(l => l.id === id)!.metadata = metadata }); return data.links.find(l => l.id === id)! },
  'links:remove': ({ id }) => { commit(next => { next.links = next.links.filter(l => l.id !== id) }); return ok },
  'link:sendHighlightToNote': input => { const path = input.noteRelPath ?? NOTE; const current = data.notes[key(input.courseId, path)]; writeNote(input.courseId, path, `${current?.markdown ?? '# 학습 노트\n'}\n> ${input.quote}\n\n[${input.page}쪽](bandal://material?path=${encodeURIComponent(input.relPath)}&page=${input.page})\n${input.comment ?? ''}\n`); return { relPath: path, created: !current } },
  'board:listTasks': input => data.tasks.filter(task => (input.courseId === undefined || task.courseId === input.courseId) && (input.includeDone !== false || task.status !== 'done')),
  'board:createTask': input => { const task = { ...input, id: id(), notes: input.notes ?? '', status: input.status ?? 'todo' as const, kind: input.kind ?? 'task' as const, color: input.color ?? 'none' as const, startAt: input.startAt ?? null, dueAt: input.dueAt ?? null, allDay: input.allDay ?? true, sortOrder: data.tasks.length, createdAt: stamp(), updatedAt: stamp() }; commit(next => { next.tasks.push(task) }); emit('board:changed', { courseId: task.courseId }); return task },
  'board:updateTask': input => { commit(next => { Object.assign(next.tasks.find(t => t.id === input.id)!, input, { updatedAt: stamp() }) }); const task = data.tasks.find(t => t.id === input.id)!; emit('board:changed', { courseId: task.courseId }); return task },
  'board:reorderTasks': ({ courseId, updates }) => { commit(next => { for (const update of updates) Object.assign(next.tasks.find(t => t.id === update.id)!, update) }); emit('board:changed', { courseId }); return data.tasks.filter(t => t.courseId === courseId) },
  'board:deleteTask': ({ id }) => { const task = data.tasks.find(t => t.id === id); commit(next => { next.tasks = next.tasks.filter(t => t.id !== id) }); emit('board:changed', { courseId: task?.courseId ?? null }); return ok },
  'calendar:range': ({ from, to, courseId }) => data.tasks.filter(task => { const range = taskCalendarInterval(task); if (!range) return false; const start = localDateValue(range.start).getTime(), end = localDateValue(range.end).getTime(); return (courseId === undefined || task.courseId === courseId) && start < Date.parse(to) && Math.max(end, start + 1) > Date.parse(from) }),
  'calendar:upcoming': () => [],
  'appleCalendar:state': () => ({ supported: false, connected: false, authorization: 'not-determined', calendars: [], selectedCalendarIds: [], destinationCalendarId: null }),
  'appleCalendar:events': () => [],
  'auth:getState': () => ({ phase: 'unconfigured', profile: null, email: null, online: true, errorCode: null }),
  'plugins:list': () => ({ plugins: [] }),
  'plugins:devFolders': () => ({ folders: [] }),
  'packs:list': () => ({ packs: [] }),
  'study:tools': () => ({ tools: [] }),
  'canvas:list': () => [],
  'favorites:list': () => [],
  'activity:recent': () => [],
  'activity:record': () => ok,
  'browser:setDownloadTarget': () => ok,
  'browserAgent:syncTabs': () => ok,
  'agent:syncWorkspace': () => ok,
  'ui:consumePendingOpen': () => null,
  'agent:availability': () => ({ installed: true, loggedIn: true }),
  'agent:skills': () => [],
  'agent:models': ({ provider }) => ({ models: provider === 'codex' ? [{ id: 'gpt-5.4', displayName: 'GPT-5.4 · 예시', isDefault: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh'] }] : provider === 'gemini' ? [{ id: 'gemini-3.1-pro-preview', displayName: 'Gemini Pro · 예시', isDefault: true }] : [{ id: 'sonnet', displayName: 'Sonnet · 예시', isDefault: true, supportedEfforts: ['low', 'medium', 'high'] }, { id: 'opus', displayName: 'Opus · 예시', isDefault: false, supportedEfforts: ['low', 'medium', 'high', 'max'] }] }),
  'agentTools:confirmations': () => [],
  'chat:grants': () => ({ grants: [] }),
  'chat:conversations': ({ courseId }) => ({ conversations: Object.values(data.chats).filter(c => c.session.courseId === courseId).map(c => ({ ...c.session, createdAt: c.session.lastUsedAt ?? stamp(), messageCount: c.messages.length })) }),
  'chat:open': ({ courseId, sessionId }) => {
    const chat = session(courseId, sessionId)
    if (chat.messages.length === 0) {
      const user = message(courseId, sessionId, 'user', ko ? '체이닝과 개방 주소법은 어떻게 달라?' : 'How do chaining and open addressing differ?')
      const reply = message(courseId, sessionId, 'assistant', answer)
      commit(next => { next.chats[sessionId]!.messages = [user, reply] })
    }
    return { availability: { installed: true, loggedIn: true }, sessionInfo: data.chats[sessionId]!.session, history: data.chats[sessionId]!.messages }
  },
  'chat:setConfiguration': ({ courseId, sessionId, model, effort }) => { session(courseId, sessionId); commit(next => { Object.assign(next.chats[sessionId]!.session, { model, effort }) }); return { model, effort } },
  'chat:setProvider': ({ courseId, sessionId, provider }) => { session(courseId, sessionId); commit(next => { Object.assign(next.chats[sessionId]!.session, { provider, model: null, effort: null }) }); return { sessionInfo: data.chats[sessionId]!.session, carried: { messages: 0, chars: 0, truncated: false } } },
  'chat:send': ({ courseId, sessionId, content }) => {
    const user = message(courseId, sessionId, 'user', content)
    commit(next => { next.chats[sessionId]!.messages.push(user) })
    const timer = setTimeout(() => {
      const reply = message(courseId, sessionId, 'assistant', answer)
      commit(next => { next.chats[sessionId]!.messages.push(reply) })
      emit('chat:event-batch', { courseId, sessionId, seq: ++sequence, events: [{ type: 'text-final', blockId: reply.blocks[0]!.id, text: answer }, { type: 'turn-complete', stopReason: 'success' }] })
      pending.delete(sessionId)
    }, 550)
    pending.set(sessionId, timer)
    return { turnSeq: user.turnSeq }
  },
  'chat:cancel': ({ courseId, sessionId }) => { clearTimeout(pending.get(sessionId)); pending.delete(sessionId); emit('chat:event-batch', { courseId, sessionId, seq: ++sequence, events: [{ type: 'turn-complete', stopReason: 'interrupted' }] }); return ok },
  'chat:close': () => ok,
  'chat:deleteConversation': ({ sessionId }) => { commit(next => { delete next.chats[sessionId] }); return ok },
  'overlay:getState': () => ({ mode: 'in-app', courseId, conversationId: null, popupOpen: false, desktopVisible: false, screenPermission: 'unsupported' }),
  'mcp:list': () => ({ servers: [], availability: { available: false, reason: '웹 체험에서는 계정과 외부 도구를 연결하지 않습니다.' } }),
  'agentTools:changes': ({ turnId }) => ({ turnId, actions: [] }),
  'overlay:setCourse': ({ courseId }) => ({ mode: 'in-app', courseId, conversationId: null, popupOpen: false, desktopVisible: false, screenPermission: 'unsupported' }),
  'overlay:setConversation': ({ courseId, conversationId }) => ({ mode: 'in-app', courseId, conversationId, popupOpen: false, desktopVisible: false, screenPermission: 'unsupported' }),
  'search:indexPdfPages': () => ok,
  'search:query': ({ courseId, query }) => ({ hits: Object.values(data.notes).filter(n => n.courseId === courseId && n.markdown.includes(query)).map(n => ({ kind: 'note' as const, relPath: n.relPath, page: null, snippet: n.markdown.slice(0, 180), score: 1 })) })
}

/** Only this adapter is demo-specific. All visible app components are production code. */
export const adapter: IpcAdapter = {
  async invoke<K extends IpcChannel>(channel: K, req: IpcRequest<K>): Promise<IpcResponse<K>> {
    const handler = handlers[channel] as ((input: IpcRequest<K>) => IpcResponse<K> | Promise<IpcResponse<K>>) | undefined
    if (handler) return structuredClone(await handler(req))
    if (channel === 'update:status') return { phase: 'unsupported', currentVersion: __APP_VERSION__ } as IpcResponse<K>
    window.dispatchEvent(new CustomEvent('bandal-demo-unavailable', { detail: channel }))
    throw new Error(ko ? '이 기능은 설치한 반달 앱에서 사용할 수 있어요. 웹 체험에서는 PDF·필기·과제·달력·AI 예시를 이용해보세요.' : 'This feature is available in the desktop app. Try PDFs, notes, tasks, calendar and the example AI chat here.')
  },
  on(channel, callback) {
    let set = listeners.get(channel)
    if (!set) { set = new Set(); listeners.set(channel, set) }
    set.add(callback as (value: never) => void)
    return () => { set.delete(callback as (value: never) => void) }
  }
}

export function exportNotes(): void {
  const markdown = Object.values(data.notes).filter(note => note.courseId === courseId).map(note => `<!-- ${note.relPath} -->\n${note.markdown}`).join('\n\n---\n\n')
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = '반달-웹체험-필기.md'; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
