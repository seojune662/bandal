import { DEFAULT_SETTINGS, type Settings } from '../src/shared/types/settings'
import { createPdfPageNoteMarkdown } from '../src/shared/pdfPageNote'
import type { Course } from '../src/shared/types/course'
import type { BoardTask } from '../src/shared/types/board'
import type { Annotation } from '../src/shared/types/annotation'
import type { Drawing } from '../src/shared/types/drawing'
import type { NoteContent } from '../src/shared/types/note'
import type { MaterialLinkRecord } from '../src/shared/types/link'
import type { PdfViewState } from '../src/shared/types/pdfViewState'
import type { ChatMessage, ChatSessionInfo } from '../src/shared/types/chat'
import { PDF_FINGERPRINT } from './sample'

export const mode = new URLSearchParams(location.search).get('view') ?? 'workspace'
export const ko = new URLSearchParams(location.search).get('lang') !== 'en'
export const PDF = '03-해시테이블.pdf'
export const NOTE = '중간고사 정리.md'
export const PAGE_NOTE = '03-해시테이블 페이지 필기.md'
export const courseId = 'demo-data-structures'
export const stamp = () => new Date().toISOString()
export const id = () => crypto.randomUUID()
export const key = (course: string, path: string) => `${course}/${path}`
const storageKey = `bandal-app-demo-v1:${mode}:${ko ? 'ko' : 'en'}`

export interface DemoData {
  version: 1
  scene?: string
  primaryNotePath?: string
  courses: Course[]
  notes: Record<string, NoteContent>
  layouts: Record<string, unknown>
  views: Record<string, PdfViewState>
  tasks: BoardTask[]
  annotations: Annotation[]
  drawings: Drawing[]
  links: MaterialLinkRecord[]
  chats: Record<string, { session: ChatSessionInfo; messages: ChatMessage[] }>
}
const courseSeeds = ko ? ['자료구조', '운영체제', '선형대수', '컴퓨터구조'] : ['Data structures', 'Operating systems', 'Linear algebra', 'Computer architecture']
export const pdfDescriptor = { kind: 'pdf', payload: { courseId, relPath: PDF } } as const
export const pageNoteDescriptor = { kind: 'note', payload: { courseId, relPath: PAGE_NOTE } } as const
const metadata = { version: 1 as const, syncScroll: true, fingerprint: PDF_FINGERPRINT, pageSizes: Array.from({ length: 3 }, () => ({ width: 960, height: 720 })) }
function seed(): DemoData {
  const courses: Course[] = courseSeeds.map((name, i) => ({ id: i ? `demo-course-${i}` : courseId, name, color: ['gold', 'green', 'blue', 'violet'][i]!, slug: `course-${i}`, folderPath: '/웹 체험/과목', source: 'managed', missing: false, archived: false, groupId: null, sortOrder: i, createdAt: stamp(), updatedAt: stamp() }))
  const notes: Record<string, NoteContent> = {}
  for (const course of courses) {
    notes[key(course.id, NOTE)] = { courseId: course.id, relPath: NOTE, mtime: Date.now(), markdown: ko ? '# 해시 테이블과 충돌 해결\n\n키를 배열의 인덱스로 변환해 값을 저장한다. 평균 탐색 시간은 **O(1)**.\n\n## 오늘의 핵심\n\n- 같은 키는 같은 인덱스로 연결된다.\n- 충돌은 서로 다른 키가 같은 인덱스를 가리킬 때 발생한다.\n- 적재율이 커질수록 충돌 가능성이 높아진다.\n\n## 두 가지 충돌 해결 방법\n\n| 방식 | 아이디어 |\n| --- | --- |\n| 체이닝 | 같은 버킷에 연결 리스트로 저장 |\n| 개방 주소법 | 배열 안에서 빈 공간을 탐색 |\n\n> 여기에 내 생각을 적어보세요. 필기는 이 브라우저에 저장됩니다.\n\n- [x] 해시 함수와 충돌 개념 정리\n- [ ] 체이닝 직접 구현하기\n- [ ] 선형 탐사 예제 풀기\n' : '# Hash tables and collisions\n\nA hash function maps a key to an array index. Average lookup is **O(1)**.\n\n## Two approaches\n\n- **Chaining:** keep entries in the same bucket.\n- **Open addressing:** find another empty slot.\n\n> Try editing these notes. Changes stay in this browser.\n\n- [x] Understand collisions\n- [ ] Implement chaining\n' }
  }
  notes[key(courseId, PAGE_NOTE)] = { courseId, relPath: PAGE_NOTE, mtime: Date.now(), markdown: createPdfPageNoteMarkdown('해시 테이블 페이지 필기', PDF, PDF_FINGERPRINT, metadata.pageSizes, ['## 해시 테이블\n\n키 → 해시 함수 → 배열 인덱스\n\n평균 탐색 시간은 **O(1)**\n\n### 충돌이 생기면?\n\n서로 다른 키가 같은 인덱스를 가리킨다.\n\n체이닝 또는 개방 주소법으로 해결한다.', '## 충돌 해결\n\n**체이닝**: 같은 버킷에 연결한다.\n\n**개방 주소법**: 배열 안의 빈 공간을 찾는다.', '## 복습 질문\n\n적재율이 높아지면 탐색 비용은 어떻게 달라질까?\n\n- [ ] 체이닝 예시 그려보기\n- [ ] 평균과 최악의 경우 비교하기']) }
  const titles = ko ? ['해시 테이블 구현 과제', '운영체제 4장 읽기', '행렬 연산 연습문제', '충돌 해결 방식 비교', '3주차 강의 복습'] : ['Implement a hash table', 'Read OS chapter 4', 'Matrix exercises', 'Compare collision handling', 'Review lecture 3']
  return { version: 1, primaryNotePath: NOTE, courses, notes, layouts: {}, views: {}, annotations: [], drawings: [], chats: {},
    links: [{ id: 'demo-pdf-note-link', courseId, source: pdfDescriptor, target: pageNoteDescriptor, kind: 'pdf-page-note', label: '페이지 필기', metadata, createdAt: stamp() }],
    tasks: titles.map((title, i) => { const date = new Date(); date.setDate(date.getDate() + i + 1); const dueAt = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; return { id: `demo-task-${i}`, title, courseId: courses[i % courses.length]!.id, notes: '', kind: i % 2 ? 'task' : 'assignment', color: 'none', status: i < 3 ? 'todo' : i === 3 ? 'in-progress' : 'done', dueAt, allDay: true, sortOrder: i, createdAt: stamp(), updatedAt: stamp() } }) }
}
let memoryOnly = false
function restore(): DemoData {
  try { localStorage.setItem(storageKey + ':probe', '1'); localStorage.removeItem(storageKey + ':probe') } catch { memoryOnly = true }
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as DemoData | null
    if (parsed?.version === 1 && Array.isArray(parsed.courses) && Array.isArray(parsed.tasks) && parsed.notes && parsed.links) return parsed
  } catch { /* Invalid persisted examples fall back to the seed. */ }
  return seed()
}
export let data = restore()
export const settings: Settings = { ...structuredClone(DEFAULT_SETTINGS), locale: ko ? 'ko-KR' : 'en-US', restoreLastCourse: true, lastActiveCourseId: courseId,
  university: { ...DEFAULT_SETTINGS.university, universityId: 'snu' },
  onboarding: { flowVersion: 2, closedAt: stamp(), lastCompletedStep: 3 }, tutorial: { seenVersion: 1, activeCourseId: null }, assistantMode: 'in-app' }
export function commit(update: (next: DemoData) => void): void {
  const next = structuredClone(data)
  update(next)
  if (!memoryOnly) {
    try { localStorage.setItem(storageKey, JSON.stringify(next)) }
    catch { throw new Error(ko ? '브라우저 저장 공간이 부족해 저장하지 못했습니다. 필기를 내보낸 뒤 체험 데이터를 초기화해주세요.' : 'Browser storage is full. Export your notes before resetting the demo.') }
  }
  data = next
}
export function resetDemo(): void { try { localStorage.removeItem(storageKey) } catch {} location.reload() }
export function storageLabel(): string { return memoryOnly ? (ko ? '현재 창에서만 유지됩니다' : 'Changes last for this window') : (ko ? '이 브라우저에 자동 저장' : 'Autosaved in this browser') }
