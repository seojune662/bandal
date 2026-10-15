import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = resolve(import.meta.dirname, '../../..')
const workdir = mkdtempSync(join(tmpdir(), 'bandal-sync-access-check-'))
const cli = process.env.BANDAL_SUPABASE_CLI || 'supabase'
mkdirSync(join(workdir, 'supabase', 'migrations'), { recursive: true })
writeFileSync(join(workdir, 'supabase', 'config.toml'), `project_id = "bandal-sync-${workdir.split('-').at(-1).toLowerCase()}"
[api]
enabled = true
port = 56831
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
[db]
port = 56832
shadow_port = 56830
major_version = 17
[db.seed]
enabled = false
[auth]
enabled = true
site_url = "http://127.0.0.1:56831"
enable_signup = true
[auth.email]
enable_signup = true
enable_confirmations = false
[storage]
enabled = true
file_size_limit = "512MiB"
[analytics]
enabled = false
`)
copyFileSync(join(root,'tests/backend/syncAccess/personal-sync-fixture.sql'),join(workdir,'supabase/migrations/202610130001_personal_sync.sql'))
for (const name of ['20261013010000_paddle_billing_sandbox.sql','20261015010000_paddle_billing_live.sql','20261015020000_sync_paid_access.sql','20261015030000_sync_quota_errors.sql']) {
  copyFileSync(join(root,'supabase/migrations',name),join(workdir,'supabase/migrations',name))
}
function run(command,args,env=process.env,quiet=false) {
  return new Promise((resolve,reject) => {
    const child=spawn(command,args,{cwd:root,env,stdio:quiet?['ignore','pipe','pipe']:'inherit'})
    let diagnostics=''
    if(quiet) for(const stream of [child.stdout,child.stderr]) stream.on('data',chunk=>{diagnostics=(diagnostics+String(chunk)).slice(-16000)})
    child.on('error',()=>reject(new Error('Local sync test process could not start')))
    child.on('exit',code=>{
      if(code===0)return resolve()
      if(quiet){
        const safe=diagnostics.split('\n').filter(line=>/error|failed|unhealthy|invalid|fatal|port.*(use|allocated)/i.test(line)&&!/secret|token|key|password|authorization|jwt/i.test(line))
          .slice(-8).map(line=>line.replace(/(?:https?|postgres(?:ql)?):\/\/\S+/gi,'[redacted URL]').replace(/[A-Za-z0-9_+/.=-]{32,}/g,'[redacted opaque value]'))
        if(safe.length)console.error(safe.join('\n'))
      }
      reject(new Error(`Local sync test process exited ${code}${quiet?' (credential output withheld)':''}`))
    })
  })
}
try {
  console.info('Starting isolated sync access Auth/Postgres/Storage on ports 56830–56832…')
  await run(cli,['start','--workdir',workdir,'--exclude','realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'],process.env,true)
  await run(process.execPath,['node_modules/vitest/vitest.mjs','run','tests/backend/syncAccess/integration.test.ts','--testTimeout','20000'],{
    ...process.env,BANDAL_SYNC_ACCESS_TEST_DIR:workdir,BANDAL_SUPABASE_CLI:cli
  })
} finally {
  await run(cli,['stop','--workdir',workdir,'--no-backup'],process.env,true)
    .catch(()=>console.error('Could not stop the isolated sync test project; inspect the temporary project manually.'))
  rmSync(workdir,{recursive:true,force:true})
}
