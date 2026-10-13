import { mkdtempSync,mkdirSync,writeFileSync,copyFileSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { spawn } from 'node:child_process'
const root=resolve(import.meta.dirname,'../../..'),workdir=mkdtempSync(join(tmpdir(),'bandal-study-market-check-'))
mkdirSync(join(workdir,'supabase','migrations'),{recursive:true})
writeFileSync(join(workdir,'supabase','config.toml'),`project_id = "bandal-study-${workdir.split('-').at(-1).toLowerCase()}"
[api]
enabled = true
port = 56621
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
[db]
port = 56622
shadow_port = 56620
major_version = 17
[db.seed]
enabled = false
[auth]
enabled = true
site_url = "http://127.0.0.1:56621"
enable_signup = true
[auth.email]
enable_signup = true
enable_confirmations = false
[storage]
enabled = true
file_size_limit = "50MiB"
[analytics]
enabled = false
`)
writeFileSync(join(workdir,'supabase','migrations','20261012000000_fixture.sql'),`create table public.profiles(id uuid primary key references auth.users(id),nickname text); alter table public.profiles enable row level security; grant all on public.profiles to service_role;`)
copyFileSync(join(root,'supabase/migrations/20261013000000_study_market.sql'),join(workdir,'supabase/migrations/20261013000000_study_market.sql'))
async function run(command,args,env=process.env,quiet=false){
  return new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd:root,env,stdio:quiet?['ignore','pipe','pipe']:'inherit'});let diagnostics='';if(quiet){const collect=chunk=>{diagnostics=(diagnostics+String(chunk)).slice(-16000)};child.stdout.on('data',collect);child.stderr.on('data',collect)};child.on('error',reject);child.on('exit',code=>{if(code===0)return resolve();if(quiet){const safe=diagnostics.split('\n').filter(line=>/error|failed|unhealthy|migration|port.*(use|allocated)/i.test(line)&&!/secret|token|key|password|postgres(ql)?:/i.test(line)).slice(-15).map(line=>line.replace(/eyJ[A-Za-z0-9_.-]+/g,'[redacted JWT]'));if(safe.length)console.error(safe.join('\n'))}reject(new Error(`${command} exited ${code}${quiet?' (credential output withheld)':''}`))})})
}
try{
  console.info('Starting isolated Auth, Postgres and private Storage on ports 56620–56622…')
  await run('supabase',['start','--workdir',workdir,'--exclude','realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'],process.env,true)
  await run(process.execPath,['node_modules/vitest/vitest.mjs','run','tests/backend/studyMarket/integration.test.ts'],{...process.env,BANDAL_STUDY_MARKET_TEST_DIR:workdir})
}finally{
  await run('supabase',['stop','--workdir',workdir,'--no-backup'],process.env,true).catch(e=>console.error(e.message))
  rmSync(workdir,{recursive:true,force:true})
}
