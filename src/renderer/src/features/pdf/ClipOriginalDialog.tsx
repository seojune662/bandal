import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Document, Page } from 'react-pdf'
import type { DrawingClipSource } from '../../../../shared/types/drawing'
import { mediaUrlFor } from '../materials/mediaUrl'
import './pdfWorker'

/** Immutable source preview; opening a clip never navigates to another page
 * of a subsequently reordered document or edits its current annotations. */
export function ClipOriginalDialog({ courseId, source, onClose }: {courseId:string;source:DrawingClipSource;onClose:()=>void}):JSX.Element {
  const [page,setPage]=useState(source.page),[count,setCount]=useState(0)
  const file=useMemo(()=>({url:mediaUrlFor(courseId,source.relPath)+(source.documentRevision?`?revision=${source.documentRevision}`:'')}),[courseId,source.relPath,source.documentRevision])
  useEffect(()=>{const handler=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();onClose()}};document.addEventListener('keydown',handler);return()=>document.removeEventListener('keydown',handler)},[onClose])
  return createPortal(<div data-bandal-native-overlay="true" role="presentation" onPointerDown={event=>{if(event.target===event.currentTarget)onClose()}} style={{position:'fixed',inset:0,zIndex:10000,display:'grid',placeItems:'center',background:'rgba(0,0,0,.6)',padding:20}}>
    <section role="dialog" aria-modal="true" aria-label="클립을 만든 당시 원문" style={{width:'min(92vw,960px)',height:'90vh',display:'flex',flexDirection:'column',background:'var(--bg-surface, #fff)',color:'var(--text-primary, #222)',borderRadius:12,overflow:'hidden',boxShadow:'0 20px 80px #0008'}}>
      <header style={{padding:'14px 18px',display:'flex',gap:12,alignItems:'center',borderBottom:'1px solid #8884'}}>
        <div style={{flex:1}}><strong>클립을 만든 당시 원문</strong><div style={{fontSize:12,opacity:.7,marginTop:4}}>{source.label} · 읽기 전용</div></div>
        <button type="button" onClick={onClose} autoFocus aria-label="원문 보기 닫기">닫기</button>
      </header>
      <div style={{flex:1,overflow:'auto',background:'#7773',padding:16,display:'grid',justifyItems:'center',alignContent:'start'}}>
        <Document file={file} onLoadSuccess={document=>{setCount(document.numPages);setPage(value=>Math.min(value,document.numPages))}} loading="보관된 원문을 여는 중…" error="보관된 원문을 열 수 없습니다. 클립과 복구 기록은 유지됩니다.">
          <Page pageNumber={page} width={Math.min(window.innerWidth*.84,880)} renderAnnotationLayer={false} renderTextLayer={false}/>
        </Document>
      </div>
      <footer style={{display:'flex',justifyContent:'center',alignItems:'center',gap:16,padding:12}}>
        <button type="button" disabled={page<=1} onClick={()=>setPage(value=>value-1)}>이전</button><span>{page} / {count||'…'}</span><button type="button" disabled={!count||page>=count} onClick={()=>setPage(value=>value+1)}>다음</button>
      </footer>
    </section>
  </div>,document.body)
}
