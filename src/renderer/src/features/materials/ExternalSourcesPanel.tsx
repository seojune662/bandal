import { useEffect, useRef, useState } from 'react'
import type { ExternalSourceEntry, ExternalSourceLocation } from '../../../../shared/types/externalSources'
import { Icon } from '../../app/icons'
import { showToast } from '../../app/toast'
import { invoke, startExternalFileDrag } from '../../lib/ipc'
import { useMaterialsStore } from '../../stores/materialsStore'
import './externalSources.css'

function SourceThumbnail({ entry }: { entry: ExternalSourceEntry }): JSX.Element {
  const [source, setSource] = useState<string | null>(null)
  const element = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (entry.kind !== 'image') return
    let active = true
    let requested = false
    const load = (): void => {
      if (requested) return
      requested = true
      void invoke('externalSources:thumbnail', { id: entry.id }).then(result => {
        if (active) setSource(result.dataUrl)
      }).catch(() => undefined)
    }
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(records => {
      if (records.some(record => record.isIntersecting)) { load(); observer?.disconnect() }
    })
    if (observer && element.current) observer.observe(element.current)
    else load()
    return () => { active = false; observer?.disconnect() }
  }, [entry.id, entry.kind])
  return <span className="external-source-entry__thumbnail" ref={element}>
    {source ? <img src={source} alt="" draggable={false} /> : <Icon name={entry.kind === 'dir' ? 'folder' : entry.kind === 'image' ? 'fileImage' : entry.kind === 'pdf' ? 'filePdf' : entry.kind === 'note' ? 'fileText' : 'file'} />}
  </span>
}

export function ExternalSourcesPanel({ courseId }: { courseId: string | null }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState<'folder' | 'photos'>('folder')
  const [folder, setFolder] = useState<ExternalSourceLocation | null>(null)
  const [photos, setPhotos] = useState<ExternalSourceLocation | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const location = source === 'folder' ? folder : photos
  const isMac = window.bandal?.platform === 'darwin'
  async function run(operation: () => Promise<ExternalSourceLocation | null>): Promise<void> {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const result = await operation()
      if (result) (result.kind === 'folder' ? setFolder : setPhotos)(result)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '자료를 열지 못했습니다.')
    } finally { setBusy(false) }
  }
  function pick(): void {
    void run(() => source === 'folder' ? invoke('externalSources:pickFolder', {}) : invoke('externalSources:pickPhotos', {}))
  }
  async function importEntry(entry: ExternalSourceEntry): Promise<void> {
    if (!courseId || busy) return
    setBusy(true); setError(null)
    try {
      const result = await invoke('externalSources:import', { id: entry.id, courseId })
      if (result.failed.length) throw new Error(result.failed[0]?.reason ?? '자료를 가져오지 못했습니다.')
      await useMaterialsStore.getState().loadTree(courseId, { refreshOnly: true })
      showToast('과목 자료에 추가했어요.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '자료를 가져오지 못했습니다.')
    } finally { setBusy(false) }
  }
  if (window.bandal?.platform === 'web') return <></>
  return <section className="external-sources" aria-label="외부 자료">
    <button type="button" className="external-sources__heading" aria-expanded={open} onClick={() => setOpen(!open)}>
      <Icon name="chevronRight" className={open ? 'external-sources__chevron--open' : ''} />
      <span>외부 자료</span><span className="external-sources__heading-hint">파일 · 사진</span>
    </button>
    {open && <div className="external-sources__content">
      <div className="external-sources__tabs" role="tablist" aria-label="외부 자료 위치">
        <button type="button" role="tab" aria-selected={source === 'folder'} onClick={() => { setSource('folder'); setError(null) }}><Icon name="folder" />{isMac ? 'Finder' : '파일'}</button>
        <button type="button" role="tab" aria-selected={source === 'photos'} onClick={() => { setSource('photos'); setError(null) }}><Icon name="fileImage" />사진</button>
      </div>
      <div className="external-sources__toolbar">
        {source === 'folder' && location?.parentId && <button type="button" aria-label="상위 폴더" title="상위 폴더" disabled={busy} onClick={() => void run(() => invoke('externalSources:list', { id: location.parentId! }))}><Icon name="chevronLeft" /></button>}
        <span title={location?.label}>{location?.label ?? (source === 'folder' ? '연결한 폴더 없음' : '선택한 사진 없음')}</span>
        {source === 'folder' && folder && <button type="button" aria-label="외부 폴더 새로고침" title="새로고침" disabled={busy} onClick={() => void run(() => invoke('externalSources:list', { id: folder.id }))}><Icon name="refresh" /></button>}
        <button type="button" className="external-sources__connect" disabled={busy} onClick={pick}>{source === 'folder' ? (folder ? '변경' : '폴더 연결') : '사진 선택'}</button>
      </div>
      {busy && <p className="external-sources__hint" role="status">자료를 불러오는 중…</p>}
      {error && <p className="external-sources__error" role="alert">{error}</p>}
      {location && location.entries.length > 0 ? <div className="external-sources__grid" aria-label={source === 'folder' ? '연결한 폴더의 파일' : '선택한 사진'}>
        {location.entries.map(entry => <div key={entry.id} className="external-source-entry" draggable={entry.kind !== 'dir'} title={entry.name}
          onDragStart={event => { if (entry.kind === 'dir') return; event.preventDefault(); event.stopPropagation(); startExternalFileDrag(entry.id) }}>
          <button type="button" className="external-source-entry__open" disabled={busy || (!courseId && entry.kind !== 'dir')}
            aria-label={`${entry.name} ${entry.kind === 'dir' ? '폴더 열기' : '가져오기'}`}
            onClick={() => entry.kind === 'dir' ? void run(() => invoke('externalSources:list', { id: entry.id })) : void importEntry(entry)}>
            <SourceThumbnail entry={entry} /><span className="external-source-entry__name">{entry.name}</span>
          </button>
        </div>)}
      </div> : !busy && <p className="external-sources__empty">{location ? '표시할 자료가 없어요.' : source === 'folder' ? '폴더를 연결하면 이곳에서 파일을 작게 펼쳐볼 수 있어요.' : '사진을 선택하면 이곳에서 미리 보고 끌어올 수 있어요.'}</p>}
      {location?.truncated && <p className="external-sources__hint">처음 {location.entries.length}개를 표시했어요. 더 작은 폴더를 연결해 주세요.</p>}
      <p className="external-sources__hint">이미지는 PDF·노트에 끌어 놓으세요. 파일을 누르면 {courseId ? '현재 과목 자료에 추가돼요.' : '과목을 선택한 뒤 추가할 수 있어요.'}</p>
    </div>}
  </section>
}
