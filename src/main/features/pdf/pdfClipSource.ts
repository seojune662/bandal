import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DrawingClipSource } from '../../../shared/types/drawing'
import { resolveInsideReal } from '../../db/validate'
import { pdfFileRevision } from './pdfOriginals'

export function resolvePdfClipSource(userDataPath:string,courseFolder:string,source:DrawingClipSource):string {
  if(source.documentRevision===undefined)return resolveInsideReal(courseFolder,source.relPath)
  if(!/^[a-f0-9]{64}$/.test(source.documentRevision))throw new Error('Invalid clipped PDF revision')
  const path=join(userDataPath,'PDFOriginals',`${source.documentRevision}.pdf`)
  if(!existsSync(path)||pdfFileRevision(path)!==source.documentRevision)throw new Error('보관된 클립 PDF 원본을 찾을 수 없습니다.')
  return path
}
/** Pin every existing reference before changing source page order or count.
 * The source PDF is already verified/preserved by its durable binding. */
export function pinPdfClipSources(db:any,courseId:string,relPath:string,revision:string,byteCount:number):void {
  const material=db.prepare('SELECT material_id FROM pdf_document_aliases WHERE course_id=? AND rel_path=?').get(courseId,relPath)
  const pdfRows=db.prepare("SELECT id,data_json FROM pdf_drawings WHERE course_id=? AND kind='clip'").all(courseId)
  const boardRows=db.prepare("SELECT s.id,s.data_json FROM whiteboard_local_shapes s JOIN whiteboards b ON b.id=s.board_id WHERE b.course_id=? AND s.kind='clip'").all(courseId)
  for(const [table,rows] of [['pdf_drawings',pdfRows],['whiteboard_local_shapes',boardRows]] as const)for(const row of rows){
    const data=JSON.parse(row.data_json),clip=data.clip
    if(!clip||clip.documentRevision||clip.relPath!==relPath)continue
    clip.documentRevision=revision;clip.documentByteCount=byteCount
    if(material)clip.materialID=material.material_id
    db.prepare(`UPDATE ${table} SET data_json=? WHERE id=?`).run(JSON.stringify(data),row.id)
  }
}

export function isReferencedClipRevision(db:any,courseId:string,relPath:string,revision:string):boolean {
  if(!/^[a-f0-9]{64}$/.test(revision))return false
  const rows=[...db.prepare("SELECT data_json FROM pdf_drawings WHERE course_id=? AND kind='clip'").all(courseId),...db.prepare("SELECT s.data_json FROM whiteboard_local_shapes s JOIN whiteboards b ON b.id=s.board_id WHERE b.course_id=? AND s.kind='clip'").all(courseId)]
  return rows.some((row:any)=>{try{const clip=JSON.parse(row.data_json).clip;return clip?.relPath===relPath&&clip.documentRevision===revision}catch{return false}})
}
