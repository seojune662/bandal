#!/usr/bin/env node
// Synthetic, local-only import/export regression. Never reads real profiles or
// credentials and never uses a network service. Run under Electron for the
// production SQLite ABI, or pass better-sqlite3-node for a unit-test process.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{createRequire}=require('node:module')
async function run(root,sqliteModule='better-sqlite3',expectedBroken=false){
  const req=createRequire(path.join(root,'package.json')),SQLite=req(sqliteModule),{PDFDocument}=req('pdf-lib')
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bandal-projector-path-'))
  const profile=path.join(temporary,'Profile'),exchange=path.join(temporary,'Exchange'),courseRoot=path.join(temporary,'Courses')
  const database=path.join(profile,'bandal.db'),helper=path.join(root,'resources/ipad-bridge/projector-host.cjs'),bundle=path.join(root,'resources/ipad-bridge/backend.js')
  const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),id=()=>crypto.randomUUID()
  for(const dir of [profile,exchange,courseRoot])fs.mkdirSync(dir,{recursive:true})
  const initial=new SQLite(database);initial.exec(fs.readFileSync(path.join(root,'src/main/db/schema.sql'),'utf8'));initial.close()
  const project=(action,request={})=>require(helper).run({action,request:{scope:'personal-content-v1',...request},database,exchange,courseRoot,moduleRoot:root,bundle,sqliteModule})
  const courseID=id(),pdfID=id(),noteID=id(),inkID=id(),now='2026-10-17T00:00:00.000Z',markdown='Synthetic Mac → Windows → iPad'
  const record=(kind,key,payload)=>({id:key,kind,payload,deleted:false,formatVersion:1})
  const asset=(materialID,bytes)=>{const sha256=hash(bytes),file=path.join(exchange,sha256);fs.writeFileSync(file,bytes);return{materialID,sha256,path:file,byteCount:bytes.length,originalName:materialID===pdfID?'lecture.pdf':'roundtrip.md',contentType:materialID===pdfID?'application/pdf':'text/markdown'}}
  let db
  try{
    await project('export')
    const pdf=await PDFDocument.create();pdf.addPage([600,800]);pdf.addPage([600,800]);const pdfBytes=Buffer.from(await pdf.save()),revision=hash(pdfBytes)
    const assets=[asset(pdfID,pdfBytes),asset(noteID,Buffer.from(markdown))]
    const page={schemaVersion:1,materialID:pdfID,documentRevision:revision,page:1,coordinateSpace:'unrotated-crop-box-top-left-normalized',geometry:{cropX:0,cropY:0,width:600,height:800,rotation:0},objects:[{id:inkID,kind:'ink',data:{inkVersion:5,points:[{x:.1,y:.2,p:.4,t:0},{x:.3,y:.4,p:.7,t:10}]},style:{color:'ink',width:.004,opacity:1},createdAt:now,updatedAt:now}],highlights:[],deletedObjectIDs:[],deletedHighlightIDs:[]}
    const records=[record('course','course:'+courseID,{id:courseID,name:'Synthetic offline sync',color:'blue'}),
      ...[[pdfID,'pdf','nested/lecture.pdf',assets[0]],[noteID,'note','nested/roundtrip.md',assets[1]]].map(([mid,kind,relPath,a])=>record('material','material:'+mid,{id:mid,courseID,title:kind,fileName:path.posix.basename(relPath),revision:a.sha256,kind,byteCount:a.byteCount,createdAt:now,desktop:{relPath}})),
      record('note','note:'+noteID,{materialID:noteID,markdown}),record('drawing',`drawing:${pdfID}:${revision}:1`,{materialID:pdfID,documentRevision:revision,page:1,data:Buffer.from(JSON.stringify(page)).toString('base64')})]
    const imported=await project('import',{records,assets})
    db=new SQLite(database)
    // Reasons come only from this generated local fixture; no user content is
    // consulted. Keeping record kinds makes a parent/child failure visible.
    const conflicts=db.prepare('SELECT record_id,reason FROM ipad_sync_conflicts WHERE resolved_at IS NULL').all().map(row=>({kind:row.record_id.split(':')[0],reason:row.reason}))
    console.log(JSON.stringify({platform:process.platform,imported,conflicts}))
    if(expectedBroken){assert.equal(process.platform,'win32');assert.equal(conflicts.length,4);assert.equal(db.prepare('SELECT count(*) n FROM materials_index').get().n,0);return{reproduced:true,conflicts}}
    assert.equal(conflicts.length,0)
    const folder=db.prepare('SELECT folder_path FROM courses WHERE id=?').get(courseID).folder_path
    assert.equal(fs.readFileSync(path.join(folder,'nested/roundtrip.md'),'utf8'),markdown)
    assert.equal(hash(fs.readFileSync(path.join(folder,'nested/lecture.pdf'))),revision)
    assert.equal(db.prepare('SELECT page FROM pdf_drawings WHERE id=?').get(inkID).page,1)
    db.close();db=null
    const exported=await project('export')
    for(const item of exported.records.filter(r=>r.kind==='material')){assert.ok(!item.payload.desktop.relPath.includes('\\'));assert.ok(item.payload.desktop.relPath.startsWith('nested/'))}
    // A nested collision must retain a portable relative path on Windows too.
    const collisionID=id(),collision={...records[1],id:'material:'+collisionID,payload:{...records[1].payload,id:collisionID}}
    await project('import',{records:[collision],assets})
    db=new SQLite(database)
    assert.equal(db.prepare('SELECT rel_path FROM materials_index WHERE id=?').get(collisionID).rel_path,'nested/lecture (2).pdf')
    db.close();db=null
    // Reject lexical escapes without touching a sibling directory.
    for(const relPath of ['../outside.pdf',...(process.platform==='win32'?['..\\outside.pdf','C:\\outside.pdf','\\\\server\\share\\outside.pdf']:[])]){
      const badID=id();await project('import',{records:[{...collision,id:'material:'+badID,payload:{...collision.payload,id:badID,desktop:{relPath}}}],assets})
      db=new SQLite(database);assert.equal(db.prepare('SELECT id FROM materials_index WHERE id=?').get(badID),undefined);db.close();db=null
    }
    // Existing junction/symlink ancestors must not escape the course root.
    const outside=path.join(temporary,'Outside');fs.mkdirSync(outside)
    fs.symlinkSync(outside,path.join(folder,'escape'),process.platform==='win32'?'junction':'dir')
    const badID=id();await project('import',{records:[{...collision,id:'material:'+badID,payload:{...collision.payload,id:badID,desktop:{relPath:'escape/outside.pdf'}}}],assets})
    assert.equal(fs.existsSync(path.join(outside,'outside.pdf')),false)
    db=new SQLite(database);assert.equal(db.prepare('SELECT id FROM materials_index WHERE id=?').get(badID),undefined);db.close();db=null
    return{platform:process.platform,records:5,markdown:true,pdf:true,inkV5:true,portableNestedCollision:true,traversalRejected:true,realpathEscapeRejected:true}
  }finally{db?.close();fs.rmSync(temporary,{recursive:true,force:true})}
}
module.exports={run}
if(require.main===module&&process.argv[3]!=='better-sqlite3-node'&&!process.versions.electron){
  const root=path.resolve(process.argv[2]||'.'),electron=createRequire(path.join(root,'package.json'))('electron')
  const result=require('node:child_process').spawnSync(electron,[__filename,...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});process.exitCode=result.status??1
}else if(require.main===module)run(path.resolve(process.argv[2]||'.'),process.argv[3]||'better-sqlite3',process.argv.includes('--expect-broken')).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error);process.exitCode=1})
