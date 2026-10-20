import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync, spawn } from 'node:child_process'
const root = resolve(import.meta.dirname, '../../..')
const dir = mkdtempSync(join(tmpdir(), 'bandal-community-pg-'))
const pgConfig = spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' })
const pgBin = pgConfig.status === 0 ? pgConfig.stdout.trim() : null
const port = 56842
const env = { ...process.env, PGHOST: dir, PGPORT: String(port), PGUSER: process.env.USER, PGDATABASE: 'postgres' }
function run(cmd, args, options = {}) {
  const command = pgBin && ['initdb', 'pg_ctl', 'psql'].includes(cmd) ? join(pgBin, cmd) : cmd
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', ...options })
  if (result.status !== 0) throw new Error(`${cmd}: ${result.stderr || result.stdout || result.error}`)
  return result.stdout
}
function query(sql) { return run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At'], { input: sql }) }
async function concurrent(sql, onOutput = () => {}) {
  return new Promise(resolve => {
    const child = spawn(pgBin ? join(pgBin, 'psql') : 'psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At'], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''; child.stdout.on('data', data => { out += data; onOutput(String(data)) }); child.stderr.on('data', data => { out += data })
    child.on('close', code => resolve({ code, out })); child.stdin.end(sql)
  })
}
try {
  run('initdb', ['-D', join(dir, 'data'), '--auth=trust', '--no-locale', '--encoding=UTF8'])
  run('pg_ctl', ['-D', join(dir, 'data'), '-l', join(dir, 'postgres.log'), '-o', `-k ${dir} -p ${port} -h ''`, '-w', 'start'])
  query(readFileSync(join(root, 'tests/backend/community/fixture.sql'), 'utf8'))
  query(readFileSync(join(root, 'supabase/migrations/20261021000000_community.sql'), 'utf8'))
  console.info(query(readFileSync(join(root, 'tests/backend/community/policy.sql'), 'utf8')).trim().split('\n').filter(line => line.startsWith('PASS')).join('\n'))
  const actor = '11111111-1111-4111-8111-111111111111'
  const operator = '33333333-3333-4333-8333-333333333333'
  const post = JSON.parse(query(`set role authenticated; select set_config('request.jwt.claim.sub','${actor}',false); select public.community_request('savePost','{"requestId":"concurrent-create","category":"study","title":"Concurrent","body":"One row"}');`).trim().split('\n').at(-1))
  const reaction = `set role authenticated; select set_config('request.jwt.claim.sub','${actor}',false); select public.community_request('react','{"postId":"${post.id}","active":true}');`
  const reactions = await Promise.all(Array.from({ length: 8 }, () => concurrent(reaction)))
  if (reactions.some(result => result.code !== 0) || query(`select count(*) from public.community_reactions where post_id='${post.id}'`).trim() !== '1') throw new Error('Concurrent reaction uniqueness failed')
  const save = `set role authenticated; select set_config('request.jwt.claim.sub','${actor}',false); select public.community_request('savePost','{"requestId":"concurrent-replay","category":"study","title":"Replay","body":"One row"}');`
  const saves = await Promise.all(Array.from({ length: 6 }, () => concurrent(save)))
  const ids = new Set(saves.map(result => { if (result.code !== 0) throw new Error(result.out); return JSON.parse(result.out.trim().split('\n').at(-1)).id }))
  if (ids.size !== 1) throw new Error('Concurrent request idempotency failed')
  const entries = query(`select id from public.community_posts where category='contest' order by id`).trim().split('\n')
  const awards = await Promise.all(entries.slice(0, 2).map((id, index) => concurrent(`set role authenticated; select set_config('request.jwt.claim.sub','${index === 0 ? operator : '55555555-5555-4555-8555-555555555555'}',false); select public.community_request('reviewPost','{"postId":"${id}","award":1,"developmentStatus":null,"developmentNote":""}');`)))
  if (awards.filter(result => result.code === 0).length !== 1 || !awards.some(result => /community_award_taken/.test(result.out))) throw new Error(`Concurrent award uniqueness failed: ${JSON.stringify(awards)}`)
  query(`insert into public.community_campaigns(id,title,summary,rules,published,starts_at,ends_at,results_at) values('deadline-race','Race','','Rules',true,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours')`)
  let unlockReady
  const lockReady = new Promise(resolve => { unlockReady = resolve })
  const holding = concurrent(`begin; update public.community_campaigns set ends_at=clock_timestamp()+interval '200 milliseconds' where id='deadline-race'; select 'LOCKED'; select pg_sleep(0.4); commit;`, chunk => { if (chunk.includes('LOCKED')) unlockReady() })
  await lockReady
  const late = await concurrent(`set role authenticated; select set_config('request.jwt.claim.sub','${actor}',false); select public.community_request('savePost','{"requestId":"race-deadline-request","category":"contest","campaignId":"deadline-race","title":"Too late","body":"Waited for lock","answers":{"audience":"A","problem":"P","workflow":"W","example":"E"}}');`)
  const lockResult = await holding
  if (lockResult.code !== 0 || late.code === 0 || !late.out.includes('community_campaign_not_open') || query(`select count(*) from public.community_posts where campaign_id='deadline-race'`).trim() !== '0') throw new Error(`Deadline after lock wait failed: ${JSON.stringify(late)}`)
  console.info('PASS concurrent reaction, request replay, award uniqueness, and server-clock deadline after lock contention (actual PostgreSQL).')
} finally {
  try { run('pg_ctl', ['-D', join(dir, 'data'), '-m', 'immediate', '-w', 'stop']) } catch {}
  rmSync(dir, { recursive: true, force: true })
}
