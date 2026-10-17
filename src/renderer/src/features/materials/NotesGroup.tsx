import { migrateCourseNotes } from '../pdfNotes/legacyMigration'
import { useMaterialsStore } from '../../stores/materialsStore'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { MaterialNode } from '../../../../shared/types/materials'
import { invoke } from '../../lib/ipc'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { descriptorFor } from '../workspace/tabIdentity'
import type { PersonalBoard } from '../../../../shared/types/whiteboard'
import { Icon } from '../../app/icons'
import { openNewNoteSheet } from '../pdfNotes/NewNoteSheet'

export const NOTES_FOLDER = '노트'
/** Notes are the PDFs in the course's `노트/` folder, newest first. */
export function noteNodes(tree: MaterialNode[]): MaterialNode[] {
  const folder = tree.find(node => node.kind === 'dir' && node.name === NOTES_FOLDER)
  return [...(folder?.children ?? [])].filter(node => node.kind === 'pdf').sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
}
export function withoutNotesFolder(tree: MaterialNode[]): MaterialNode[] {
  return tree.flatMap(node => {
    if (node.kind !== 'dir' || node.name !== NOTES_FOLDER) return [node]
    const children = (node.children ?? []).filter(child => child.kind !== 'pdf')
    return children.length ? [{ ...node, children }] : []
  })
}

/** Replaces the whiteboard group: create here, manage rows with the ordinary
 * material tree (rename, move, delete, share) rendered by the sidebar. */
export function NotesGroup({ courseId, nodes, children }: { courseId: string; nodes: MaterialNode[]; children(nodes: MaterialNode[]): ReactNode }): JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const [migration, setMigration] = useState<{courseId: string; error: string; originals: PersonalBoard[]}>({courseId,error:'',originals:[]})
  const currentCourse = useRef(courseId); currentCourse.current = courseId
  const mounted = useRef(false), sequence = useRef(0)
  const migrate = useCallback(() => {
    const request = ++sequence.current
    const current = () => mounted.current && currentCourse.current === courseId && sequence.current === request
    // Conversion continues for the captured course, but its completion must
    // never attach original board IDs or error messages to a different course.
    void migrateCourseNotes(courseId).then(async result => {
      if (!current()) return
      setMigration({courseId,error:result.failed.map(item=>item.message).join(' · '),originals:[]})
      try {
        const [boards,mappings] = await Promise.all([invoke('canvas:list',{courseId}),invoke('pdfNotes:migrationStatus',{courseId})])
        if (!current()) return
        const completed = new Set(mappings.map(item=>item.boardId))
        setMigration({courseId,error:result.failed.map(item=>item.message).join(' · '),originals:boards.filter(board=>!completed.has(board.id))})
      } catch { /* The migration result remains visible even if original listing failed. */ }
      if (current() && result.migrated.length) void useMaterialsStore.getState().loadTree(courseId,{refreshOnly:true})
    }).catch(error => {
      if (current()) setMigration({courseId,error:error instanceof Error ? error.message : '기존 노트 이전을 완료하지 못했습니다. 원본은 보존되어 있습니다.',originals:[]})
    })
  },[courseId])
  useEffect(() => { mounted.current=true; migrate(); return () => {mounted.current=false;sequence.current++} },[migrate])
  const migrationError = migration.courseId === courseId ? migration.error : ''
  const originals = migration.courseId === courseId ? migration.originals : []
  return <section className="whiteboards-group ipad-notes-group" aria-label="노트">
    <div className="materials-group-heading">
      <button type="button" className="materials-section-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><span aria-hidden="true">{expanded ? '⌄' : '›'}</span>노트 <small>{nodes.length}</small></button>
      <button type="button" className="whiteboards-group__create" aria-label="새 노트 만들기" title="새 노트 만들기" onClick={() => openNewNoteSheet(courseId)}><Icon name="plus" /></button>
    </div>
    {migrationError && <p role="alert">{migrationError}<button type="button" onClick={migrate}>이전 다시 시도</button></p>}
    {expanded && originals.length > 0 && <details><summary>이전 대기 중인 원본 {originals.length}개</summary>{originals.map(board => <button type="button" key={board.id} onClick={() => useWorkspaceStore.getState().openTab(descriptorFor('whiteboard', { courseId, boardId: board.id }))}>{board.title} 원본 열기</button>)}</details>}
    {expanded && (nodes.length ? children(nodes) : <p className="whiteboards-group__empty">아직 노트가 없어요. +로 빈 종이·줄·모눈·점 노트를 만들어요.</p>)}
  </section>
}
