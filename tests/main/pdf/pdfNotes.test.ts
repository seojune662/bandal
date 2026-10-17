import { resolvePdfClipSource, isReferencedClipRevision } from '../../../src/main/features/pdf/pdfClipSource'
import { pendingPdfConflicts, recoverPendingPdfMutation } from '../../../src/main/features/pdf/pendingPdfMutations'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { createTestDb, type TestDb } from '../helpers/testDb'
import { createCoursesRepo } from '../../../src/main/features/courses'
import { createMaterialsRepo } from '../../../src/main/features/materials'
import { createCanvasRepo } from '../../../src/main/features/canvas/canvasRepo'
import { createPdfNotesService } from '../../../src/main/features/pdf/pdfNotes'
import { createPDFDocumentBindings, createBoundPDFRepositories } from '../../../src/main/features/pdf/pdfDocumentBinding'
import { pdfFileRevision, createPDFOriginalPreserver } from '../../../src/main/features/pdf/pdfOriginals'
import { createNoteFileTransaction } from '../../../src/main/features/pdf/noteFileTransaction'
import { legacyNoteID } from '../../../src/main/features/pdf/legacyNoteMigration'
import { DRAWING_KINDS, type DrawingData } from '../../../src/shared/types/drawing'

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
describe('shared editable PDF notes', () => {
  let ctx: TestDb, courseId: string, folder: string, deps: any
  let service: ReturnType<typeof createPdfNotesService>, canvas: ReturnType<typeof createCanvasRepo>, drawings: ReturnType<typeof createBoundPDFRepositories>['drawings']
  beforeEach(() => {
    ctx = createTestDb()
    const courses = createCoursesRepo({ db: ctx.db, getDataRoot: () => join(ctx.dir,'Courses') })
    const course = courses.create({name:'Notes',color:'green'});courseId=course.id;folder=course.folderPath
    const materials = createMaterialsRepo({db:ctx.db,getCourseFolder:id=>courses.getFolder(id),revealItem:()=>{},trashItem:async()=>{}})
    const pdfBindings = createPDFDocumentBindings(ctx.db, (_id,path)=>pdfFileRevision(join(folder,path)),createPDFOriginalPreserver(join(ctx.dir,'PDFOriginals'),(_id,path)=>join(folder,path)))
    drawings=createBoundPDFRepositories(ctx.db,pdfBindings).drawings
    canvas=createCanvasRepo(ctx.db)
    deps={db:ctx.db,courses,materials,pdfBindings,notes:{},links:{listFor:()=>({outgoing:[]})},userDataPath:ctx.dir,changed:()=>{}};service=createPdfNotesService(deps)
  })
  afterEach(()=>ctx.cleanup())
  test('migrates all editable object kinds once, preserves dark paper and untouched originals',async()=>{
    const board=canvas.createBoard({courseId,title:'Legacy'})
    canvas.setBackground({boardId:board.id,background:'dots',surface:'dark'});canvas.setPageCount({boardId:board.id,pageCount:2})
    for(const [index,kind] of DRAWING_KINDS.entries()){
      const data:DrawingData={box:{x:.1,y:.2,width:.3,height:.4},points:[{x:.1,y:.2,p:.3},{x:.4,y:.6,p:.9}]}
      if(kind==='textbox'){data.text='한글';data.textRuns=[{from:0,to:2,style:{bold:true}}]}
      if(kind==='image')data.image={relPath:'image.png',label:'image'}
      if(kind==='clip')data.clip={relPath:'source.pdf',page:2,crop:{x:.1,y:.2,width:.3,height:.4},label:'clip'}
      canvas.putShape({boardId:board.id,id:randomUUID(),page:index%2+1,shape:{kind,data,style:{color:'ink',width:.004,opacity:.8}}})
    }
    const original=canvas.open(board.id)
    const result=await service.migrateLegacy({courseId})
    expect(result.failed).toEqual([]);expect(result.migrated).toHaveLength(1)
    const target=result.migrated[0]!
    expect(target.materialId).toBe(legacyNoteID(board.id));expect(target.materialId).not.toBe(board.id)
    expect(canvas.open(board.id)).toEqual(original)
    const migrated=drawings.listForFile(courseId,target.relPath)
    expect(migrated.map(x=>x.kind).sort()).toEqual([...DRAWING_KINDS].sort())
    expect(migrated.every(x=>original.shapes.every(old=>old.id!==x.id))).toBe(true)
    const clip=migrated.find(x=>x.kind==='clip')!
    expect(drawings.update({id:clip.id,data:{...clip.data,box:{x:.2,y:.3,width:.3,height:.4}}}).data.clip).toEqual(clip.data.clip)
    const before=readFileSync(join(folder,target.relPath))
    expect(await service.info({courseId,relPath:target.relPath})).toMatchObject({paper:'dots',surface:'dark',orientation:'portrait'})
    const pdf=await PDFDocument.load(before);expect(pdf.getPageCount()).toBe(2)
    expect((await service.migrateLegacy({courseId})).migrated).toEqual(result.migrated)
    expect(readFileSync(join(folder,target.relPath))).toEqual(before)
    expect(drawings.listForFile(courseId,target.relPath)).toHaveLength(9)
    expect((ctx.db.prepare('SELECT original_json FROM pdf_note_migrations').get() as {original_json:string}).original_json).toContain('source.pdf')
  })
  test('defaults to lined portrait paper and rewrites editable page geometry atomically',async()=>{
    const note=await service.create({courseId,title:'New'})
    expect(await service.info({courseId,relPath:note.relPath})).toMatchObject({paper:'lines',surface:'light',orientation:'portrait'})
    const original=readFileSync(join(folder,note.relPath)), revision=hash(original)
    const ink=drawings.create({...note,courseId,page:1,kind:'ink',data:{points:[{x:.1,y:.2,p:.3}]},style:{color:'ink',width:.004,opacity:1}})
    const next=await service.restructure({courseId,relPath:note.relPath,expectedRevision:revision,pages:[{source:1,rotate:90},{source:null},{source:1}]})
    expect(next.pageMap).toEqual([[1,3]])
    expect(()=>drawings.listForFile(courseId,note.relPath,revision)).toThrow('PDF 원본')
    expect(()=>createBoundPDFRepositories(ctx.db,deps.pdfBindings).annotations.listForFile({courseId,relPath:note.relPath,documentRevision:revision})).toThrow('PDF 원본')
    expect((await service.info({courseId,relPath:note.relPath})).orientation).toBe('landscape')
    expect(drawings.listForFile(courseId,note.relPath)).toHaveLength(2)
    expect(drawings.listForFile(courseId,note.relPath).find(d=>d.id===ink.id)?.data.points?.[0]).toMatchObject({x:.8,y:.1})
    expect(()=>drawings.update({id:ink.id,documentRevision:revision,style:{color:'red',width:.004,opacity:1}})).toThrow('PDF 원본')
    expect(()=>drawings.softDelete([ink.id],revision)).toThrow('PDF 원본')
    expect(()=>drawings.create({...note,courseId,documentRevision:revision,page:1,kind:'ink',data:ink.data,style:ink.style})).toThrow('PDF 원본')
    const bytes=readFileSync(join(folder,note.relPath))
    ctx.db.exec("CREATE TRIGGER reject_note_rewrite BEFORE INSERT ON pdf_restructure_log BEGIN SELECT RAISE(ABORT,'simulated'); END")
    await expect(service.restructure({courseId,relPath:note.relPath,expectedRevision:next.documentRevision,pages:[{source:2}]})).rejects.toThrow('simulated')
    expect(readFileSync(join(folder,note.relPath))).toEqual(bytes)
    expect(drawings.listForFile(courseId,note.relPath)).toHaveLength(2)
  })
  test('source page edits pin all placed clips to the preserved original',async()=>{
    const source=await service.create({courseId,title:'Source'}),bytes=readFileSync(join(folder,source.relPath)),revision=hash(bytes)
    const target=await service.create({courseId,title:'Clips'})
    const clip=drawings.create({...target,courseId,page:1,kind:'clip',data:{box:{x:0,y:0,width:1,height:1},clip:{relPath:source.relPath,page:1,label:'original'}},style:{color:'ink',width:.004,opacity:1}})
    await service.restructure({courseId,relPath:source.relPath,expectedRevision:revision,pages:[{source:null}]})
    const pinned=drawings.listForFile(courseId,target.relPath).find(row=>row.id===clip.id)!.data.clip!
    expect(pinned.documentRevision).toBe(revision);expect(pinned.documentByteCount).toBe(bytes.length)
    expect(isReferencedClipRevision(ctx.db,courseId,source.relPath,revision)).toBe(true)
    expect(readFileSync(resolvePdfClipSource(ctx.dir,folder,pinned))).toEqual(bytes)
    expect(drawings.update({id:clip.id,data:{...clip.data,clip:pinned}}).data.clip).toEqual(pinned)
  })
  test('late-view ink is durable and recovers onto a separate editable original exactly once',async()=>{
    const note=await service.create({courseId,title:'Late edit'}),original=readFileSync(join(folder,note.relPath)),revision=hash(original)
    const ink=drawings.create({...note,courseId,page:1,kind:'ink',data:{points:[{x:.1,y:.2,p:.5}]},style:{color:'ink',width:.004,opacity:1},documentRevision:revision})
    await service.restructure({courseId,relPath:note.relPath,expectedRevision:revision,pages:[{source:1,rotate:90},{source:null}]})
    const current=readFileSync(join(folder,note.relPath))
    const request={...note,courseId,page:1,kind:'ink' as const,data:{points:[{x:.9,y:.8,p:.5}]},style:ink.style,documentRevision:revision,clientMutationId:randomUUID()}
    expect(()=>drawings.create(request)).toThrow('복구함')
    expect(()=>drawings.create(request)).toThrow('복구함')
    const pending=pendingPdfConflicts(ctx.db);expect(pending).toHaveLength(1)
    const id=pending[0].id.slice('pending-ink:'.length)
    const result=await recoverPendingPdfMutation(deps,ctx.dir,id,'local')
    expect(result.resolved).toBe(true);expect(result.recovered.relPath).not.toBe(note.relPath)
    expect(readFileSync(join(folder,note.relPath))).toEqual(current)
    expect(readFileSync(join(folder,result.recovered.relPath))).toEqual(original)
    const recovered=drawings.listForFile(courseId,result.recovered.relPath)
    expect(recovered).toHaveLength(2)
    expect(recovered.map(d=>d.data.points?.[0]?.x).sort()).toEqual([.1,.9])
    expect(recovered.every(d=>d.id!==ink.id)).toBe(true)
    expect(pendingPdfConflicts(ctx.db)).toHaveLength(0)
    expect((await recoverPendingPdfMutation(deps,ctx.dir,id,'local')).recovered.relPath).toBe(result.recovered.relPath)
    expect(drawings.listForFile(courseId,result.recovered.relPath)).toHaveLength(2)
    expect(ctx.db.prepare('SELECT mutation_json FROM pdf_pending_mutations WHERE id=?').get(id)).toBeTruthy()
  })
  test('late updates retain the archived source even when a remote rewrite removed its row',async()=>{
    const note=await service.create({courseId,title:'Deleted remote row'}),revision=hash(readFileSync(join(folder,note.relPath)))
    const ink=drawings.create({...note,courseId,page:1,kind:'ink',data:{points:[{x:.1,y:.2,p:.5}]},style:{color:'ink',width:.004,opacity:1},documentRevision:revision})
    await service.restructure({courseId,relPath:note.relPath,expectedRevision:revision,pages:[{source:null}]})
    ctx.db.prepare('DELETE FROM pdf_drawings WHERE id=?').run(ink.id)
    expect(()=>drawings.update({id:ink.id,documentRevision:revision,data:{points:[{x:.8,y:.9,p:.7}]}})).toThrow('복구함')
    const pending=pendingPdfConflicts(ctx.db)
    expect(pending).toHaveLength(1)
    const result=await recoverPendingPdfMutation(deps,ctx.dir,pending[0].id.slice('pending-ink:'.length),'local')
    expect(drawings.listForFile(courseId,result.recovered.relPath)[0]?.data.points?.[0]).toMatchObject({x:.8,y:.9,p:.7})
  })
  test('recovery restores uncommitted publication but refuses to erase a newer external edit',()=>{
    const root=join(ctx.dir,'Recovery'),dir=join(root,'interrupted'),target=join(folder,'test.pdf'),backup=join(dir,'0.original')
    mkdirSync(dir,{recursive:true});writeFileSync(backup,'before');writeFileSync(target,'after')
    const intent={id:'interrupted',entries:[{target,existed:true,backup,beforeHash:hash(Buffer.from('before')),afterHash:hash(Buffer.from('after'))}]}
    writeFileSync(join(dir,'intent.json'),JSON.stringify(intent))
    const transaction=createNoteFileTransaction(ctx.db,root);transaction.recover()
    expect(readFileSync(target,'utf8')).toBe('before');expect(existsSync(join(dir,'intent.json'))).toBe(false)
    writeFileSync(join(dir,'intent.json'),JSON.stringify(intent));writeFileSync(target,'outside edit')
    expect(()=>transaction.recover()).toThrow('외부 변경');expect(readFileSync(target,'utf8')).toBe('outside edit');expect(existsSync(backup)).toBe(true)
  })
})
