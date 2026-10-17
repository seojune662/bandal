import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { resolveInsideReal } from '../../db/validate'
import { createNoteFileTransaction } from './noteFileTransaction'
import { createDrawingsRepo } from './drawingsRepo'
import { createAnnotationsRepo } from '../annotations/annotationsRepo'

const uuidFor = (value: string) => { const hash=createHash('sha256').update(value).digest('hex'); return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}` }
export function installPendingPdfMutations(db: any): void {
  db.exec(`CREATE TABLE IF NOT EXISTS pdf_pending_mutations(id TEXT PRIMARY KEY,course_id TEXT NOT NULL,rel_path TEXT NOT NULL,expected_revision TEXT NOT NULL,mutation_json TEXT NOT NULL,created_at TEXT NOT NULL,resolved_at TEXT,recovery_rel_path TEXT)`)
}
const mutationID = (kind: string, input: any): string => uuidFor(`${input.clientMutationId ?? ''}:${JSON.stringify({kind,input})}`)
export function resolvePendingPdfMutation(db: any, kind: string, input: any): void {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='pdf_pending_mutations'").get()) return
  db.prepare('UPDATE pdf_pending_mutations SET resolved_at=? WHERE id=? AND resolved_at IS NULL').run(new Date().toISOString(), mutationID(kind,input))
}
export function retainPendingPdfMutation(db:any, kind:string, input:any, courseId:string, relPath:string): void {
  if(typeof input.documentRevision!=='string'||! /^[a-f0-9]{64}$/.test(input.documentRevision))return
  installPendingPdfMutations(db)
  const mutation=JSON.stringify({kind,input}),id=mutationID(kind,input)
  db.prepare('INSERT OR IGNORE INTO pdf_pending_mutations(id,course_id,rel_path,expected_revision,mutation_json,created_at) VALUES(?,?,?,?,?,?)').run(id,courseId,relPath,input.documentRevision,mutation,new Date().toISOString())
}
export function pendingPdfConflicts(db:any): any[] {
  installPendingPdfMutations(db)
  return db.prepare('SELECT * FROM pdf_pending_mutations WHERE resolved_at IS NULL ORDER BY created_at DESC').all().map((r:any)=>({id:`pending-ink:${r.id}`,recordID:`pending-ink:${r.id}`,kind:'pending-ink',label:r.rel_path,reason:'원본 변경 또는 동기화 중 도착해 바로 저장할 수 없었던 필기를 보관했습니다.',local:null,remote:null,assets:[],expectedRevision:r.expected_revision,createdAt:r.created_at}))
}
/** Recovery makes a new editable note from the exact viewed original. The
 * current document is never replaced by a late drawing from another viewer. */
export async function recoverPendingPdfMutation(deps:any,userDataPath:string,id:string,variant:string):Promise<any> {
  installPendingPdfMutations(deps.db)
  const {db}=deps,publish=createNoteFileTransaction(db,join(userDataPath,'NoteRecovery'));publish.recover()
  const row=db.prepare('SELECT * FROM pdf_pending_mutations WHERE id=?').get(id)
  if(!row||!['local','remote'].includes(variant))throw new Error('보관된 필기를 찾을 수 없습니다.')
  if(row.resolved_at)return{applied:1,resolved:true,...(row.recovery_rel_path?{recovered:{courseID:row.course_id,relPath:row.recovery_rel_path}}:{})}
  if(variant==='remote'){db.prepare('UPDATE pdf_pending_mutations SET resolved_at=? WHERE id=?').run(new Date().toISOString(),id);return{applied:1,resolved:true}}
  const original=join(userDataPath,'PDFOriginals',`${row.expected_revision}.pdf`)
  if(!existsSync(original))throw new Error('원본 PDF 복구 파일이 없습니다. 보관된 필기는 유지됩니다.')
  const bytes=readFileSync(original)
  if(createHash('sha256').update(bytes).digest('hex')!==row.expected_revision)throw new Error('원본 PDF 복구 파일의 무결성을 확인해 주세요.')
  const pdf=await PDFDocument.load(bytes),pageCount=pdf.getPageCount(),mutation=JSON.parse(row.mutation_json)
  const materialId=uuidFor(`pending-note:${id}`),relPath=`노트/${basename(row.rel_path,'.pdf').slice(0,70)} - 필기 복구 (${id}).pdf`
  const target=resolveInsideReal(deps.courses.getFolder(row.course_id),relPath)
  if(existsSync(target)||db.prepare('SELECT id FROM materials_index WHERE id=?').get(materialId))throw new Error('필기 복구 위치가 이미 사용 중입니다. 기존 자료를 보존했습니다.')
  const binding=db.prepare('SELECT material_id FROM pdf_document_aliases WHERE course_id=? AND rel_path=?').get(row.course_id,row.rel_path)
  const hasArchive=db.prepare("SELECT 1 FROM sqlite_master WHERE name='pdf_rewrite_archive_variants'").get()
  const archived=hasArchive&&binding?db.prepare('SELECT * FROM pdf_rewrite_archive_variants WHERE material_id=? AND revision=? ORDER BY created_at DESC LIMIT 1').get(binding.material_id,row.expected_revision):undefined
  let drawings:any[]=archived?JSON.parse(archived.drawings_json):[],annotations:any[]=archived?JSON.parse(archived.annotations_json):[]
  if(!archived){
    const bound=binding&&db.prepare('SELECT bound_sha FROM pdf_document_bindings WHERE material_id=?').get(binding.material_id)
    if(bound?.bound_sha===row.expected_revision){drawings=db.prepare('SELECT * FROM pdf_drawings WHERE course_id=? AND rel_path=?').all(row.course_id,row.rel_path);annotations=db.prepare('SELECT * FROM annotations WHERE course_id=? AND rel_path=?').all(row.course_id,row.rel_path)}
    else if(mutation.kind!=='drawing:create'&&mutation.kind!=='annotation:create')throw new Error('기존 편집 객체 복구 기록이 없습니다. 보관된 변경을 유지했습니다.')
  }
  const mapped=(old:string)=>uuidFor(`pending-note:${id}:${old}`),now=new Date().toISOString()
  publish([{target,bytes}],()=>{
    db.prepare('INSERT INTO materials_index(id,course_id,rel_path,kind,size,mtime,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(materialId,row.course_id,relPath,'pdf',bytes.length,statSync(target).mtimeMs,now,now)
    db.prepare('INSERT INTO pdf_document_bindings VALUES(?,?,?,?,?)').run(materialId,row.expected_revision,'receipt',0,now)
    db.prepare('INSERT INTO pdf_document_aliases VALUES(?,?,?)').run(row.course_id,relPath,materialId)
    for(const [table,items] of [['pdf_drawings',drawings],['annotations',annotations]] as const)for(const source of items){
      if(source.page<1||source.page>pageCount)continue
      const value={...source,id:mapped(source.id),course_id:row.course_id,rel_path:relPath},keys=Object.keys(value)
      db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(key=>value[key]))
    }
    const input={...mutation.input,courseId:row.course_id,relPath};delete input.documentRevision;delete input.clientMutationId
    const drawingRepo=createDrawingsRepo(db),annotationRepo=createAnnotationsRepo(db)
    if(mutation.kind==='drawing:create'){if(input.page<1||input.page>pageCount)throw new Error('복구할 필기 페이지가 없습니다.');drawingRepo.create(input)}
    else if(mutation.kind==='drawing:update')drawingRepo.update({...input,id:mapped(input.id)})
    else if(mutation.kind==='drawing:delete')drawingRepo.softDelete(input.ids.map(mapped))
    else if(mutation.kind==='annotation:create'){if(input.page<1||input.page>pageCount)throw new Error('복구할 강조 페이지가 없습니다.');annotationRepo.create(input)}
    else if(mutation.kind==='annotation:update')annotationRepo.update({...input,id:mapped(input.id)})
    else if(mutation.kind==='annotation:delete')annotationRepo.softDelete({id:mapped(input.id)})
    else throw new Error('지원되지 않는 필기 복구 형식입니다.')
    db.prepare('UPDATE pdf_pending_mutations SET resolved_at=?,recovery_rel_path=? WHERE id=?').run(now,relPath,id)
  })
  deps.materials.invalidateTree(row.course_id)
  return{applied:1,resolved:true,recovered:{courseID:row.course_id,relPath,materialID:materialId}}
}
