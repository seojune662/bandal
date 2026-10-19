import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SharedMaterialRequest } from '../../../../shared/types/share'
import type { MaterialNode } from '../../../../shared/types/materials'
import { invoke, onPush } from '../../lib/ipc'
import { useCoursesStore } from '../../stores/coursesStore'
import { acquirePointerPassthrough } from '../browser/webviewPassthrough'
import { useFocusTrap } from '../../components/useFocusTrap'
import { showToast } from '../../app/toast'
import './share-import.css'

function folderOptions(nodes: MaterialNode[]): { path: string; name: string }[] {
  return nodes.flatMap(node => node.kind === 'dir' ? [{ path: node.relPath, name: node.relPath }, ...folderOptions(node.children ?? [])] : [])
}

export function ShareImportDialog(): JSX.Element | null {
  const [requests, setRequests] = useState<SharedMaterialRequest[]>([])
  const [courseId, setCourseId] = useState('')
  const [directory, setDirectory] = useState('')
  const [folders, setFolders] = useState<{ path: string; name: string }[]>([])
  const [loadingFolders, setLoadingFolders] = useState(false)
  const [folderRevision, setFolderRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [newCourseName, setNewCourseName] = useState('')
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDivElement>(null)
  const courses = useCoursesStore(state => state.courses)
  const selected = useCoursesStore(state => state.selectedCourseId)
  const request = requests[0]
  useEffect(() => {
    let live = true
    const refresh = (): void => { void invoke('share:list', {}).then(items => { if (live) setRequests(items) }).catch(() => undefined) }
    const unsubscribe = onPush('share:changed', refresh)
    refresh()
    return () => { live = false; unsubscribe() }
  }, [])
  useEffect(() => {
    if (!request) return
    setCourseId(courses.some(course => course.id === selected) ? selected! : (courses[0]?.id ?? ''))
    setDirectory('')
    setError('')
  }, [request?.id]) // Preserve the selected destination while courses refresh.
  useEffect(() => {
    if (!courseId && request && courses[0]) setCourseId(courses[0].id)
  }, [courses, courseId, request])
  useEffect(() => { setDirectory('') }, [courseId])
  useEffect(() => onPush('materials:changed', event => { if (event.courseId === courseId) setFolderRevision(value => value + 1) }), [courseId])
  useEffect(() => {
    let live = true
    setFolders([])
    setError('')
    if (!courseId || !request) { setLoadingFolders(false); return }
    setLoadingFolders(true)
    void invoke('materials:tree', { courseId }).then(tree => { if (live) { const options = folderOptions(tree); setFolders(options); setDirectory(current => options.some(folder => folder.path === current) ? current : '') } })
      .catch(reason => { if (live) setError(reason instanceof Error ? reason.message : '폴더를 불러오지 못했습니다.') })
      .finally(() => { if (live) setLoadingFolders(false) })
    return () => { live = false }
  }, [courseId, request?.id, folderRevision])
  useLayoutEffect(() => request ? acquirePointerPassthrough() : undefined, [!!request])
  useFocusTrap(dialog, { active: !!request, returnFocus: true })
  async function createCourse(): Promise<void> {
    if (!newCourseName.trim() || busy) return
    setBusy(true); setError('')
    try {
      const course = await useCoursesStore.getState().createCourse({ name: newCourseName.trim(), color: 'blue' })
      setCourseId(course.id)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '과목을 만들지 못했습니다.') }
    finally { setBusy(false) }
  }
  async function dismiss(): Promise<void> {
    if (!request || busy) return
    setBusy(true)
    try { await invoke('share:dismiss', { id: request.id }); setRequests(items => items.filter(item => item.id !== request.id)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '공유 요청을 닫지 못했습니다.') }
    finally { setBusy(false) }
  }
  async function importFiles(): Promise<void> {
    if (!request || !courseId || busy || loadingFolders) return
    setBusy(true); setError('')
    try {
      const result = await invoke('share:import', { id: request.id, courseId, dirRelPath: directory })
      setRequests(items => items.filter(item => item.id !== request.id))
      useCoursesStore.getState().selectCourse(courseId)
      showToast(`${result.relPaths.length}개 자료를 가져왔습니다.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '자료를 가져오지 못했습니다.') }
    finally { setBusy(false) }
  }
  if (!request) return null
  return <div className="share-import-overlay" data-overlay="true">
    <div className="share-import-dialog" role="dialog" aria-modal="true" aria-labelledby="share-import-title" ref={dialog} tabIndex={-1}>
      <h2 id="share-import-title">공유한 자료 가져오기</h2>
      <p>자료를 저장할 과목과 폴더를 선택하세요.</p>
      <ul className="share-import-files">{request.files.map(file => <li key={file.name}>{file.name}</li>)}</ul>
      {courses.length === 0 ? <>
        <p>자료를 저장할 첫 과목을 만들어 주세요.</p>
        <label>새 과목 이름<input aria-label="새 과목 이름" value={newCourseName} disabled={busy} onChange={event => setNewCourseName(event.target.value)} /></label>
        <button type="button" disabled={busy || !newCourseName.trim()} onClick={() => { void createCourse() }}>과목 만들기</button>
      </> : <>
        <label>과목<select aria-label="과목" value={courseId} disabled={busy} onChange={event => setCourseId(event.target.value)}>
          {courses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}
        </select></label>
        <label>저장할 폴더<select aria-label="저장할 폴더" value={directory} disabled={busy || loadingFolders} onChange={event => setDirectory(event.target.value)}>
          <option value="">과목 최상위 폴더</option>{folders.map(folder => <option key={folder.path} value={folder.path}>{folder.name}</option>)}
        </select></label>
      </>}
      {error && <p role="alert" className="share-import-error">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={() => { void dismiss() }}>취소</button><button type="button" className="share-import-submit" disabled={busy || !courseId || loadingFolders || courses.length === 0} onClick={() => { void importFiles() }}>{busy ? '처리 중…' : '가져오기'}</button></footer>
    </div>
  </div>
}
