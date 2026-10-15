import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = resolve(import.meta.dirname, '../../..')
const workdir = mkdtempSync(join(tmpdir(), 'bandal-paddle-billing-check-'))
const cli = process.env.BANDAL_SUPABASE_CLI || 'supabase'
mkdirSync(join(workdir, 'supabase', 'migrations'), { recursive: true })
writeFileSync(join(workdir, 'supabase', 'config.toml'), `project_id = "bandal-paddle-${workdir.split('-').at(-1).toLowerCase()}"
[api]
enabled = true
port = 56721
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
[db]
port = 56722
shadow_port = 56720
major_version = 17
[db.seed]
enabled = false
[auth]
enabled = true
site_url = "http://127.0.0.1:56721"
enable_signup = true
[auth.email]
enable_signup = true
enable_confirmations = false
[storage]
enabled = false
[analytics]
enabled = false
`)
copyFileSync(
  join(root, 'supabase/migrations/20261013010000_paddle_billing_sandbox.sql'),
  join(workdir, 'supabase/migrations/20261013010000_paddle_billing_sandbox.sql')
)

copyFileSync(join(root, 'supabase/migrations/20261015010000_paddle_billing_live.sql'), join(workdir, 'supabase/migrations/20261015010000_paddle_billing_live.sql'))

function run(command, args, env = process.env, quiet = false) {
  return new Promise((resolve, reject) => {
    // Supabase startup/status may include local credentials. Never forward
    // those streams; the test consumes status JSON directly in memory.
    const child = spawn(command, args, { cwd: root, env, stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
    let diagnostics = ''
    if (quiet) {
      const collect = chunk => { diagnostics = (diagnostics + String(chunk)).slice(-16000) }
      child.stdout.on('data', collect)
      child.stderr.on('data', collect)
    }
    child.on('error', () => reject(new Error('Local billing test process could not start')))
    child.on('exit', code => {
      if (code === 0) return resolve()
      if (quiet) {
        // Only CLI/SQL error lines are useful here. Exclude lines naming
        // credentials, redact URI contents and opaque values before output.
        const safe = diagnostics.split('\n').filter(line => /error|failed|unhealthy|invalid|fatal|port.*(use|allocated)/i.test(line) && !/secret|token|key|password|authorization|jwt/i.test(line))
          .slice(-8).map(line => line.replace(/(?:https?|postgres(?:ql)?):\/\/\S+/gi, '[redacted URL]').replace(/[A-Za-z0-9_+/.=-]{32,}/g, '[redacted opaque value]'))
        if (safe.length) console.error(safe.join('\n'))
      }
      reject(new Error(`Local billing test process exited ${code}${quiet ? ' (credential output withheld)' : ''}`))
    })
  })
}

try {
  console.info('Starting isolated Paddle billing Auth/Postgres on ports 56720–56722…')
  await run(cli, ['start', '--workdir', workdir, '--exclude', 'realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor,storage-api'], process.env, true)
  await run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/backend/paddleBilling/integration.test.ts'], {
    ...process.env,
    BANDAL_PADDLE_BILLING_TEST_DIR: workdir,
    BANDAL_SUPABASE_CLI: cli
  })
} finally {
  await run(cli, ['stop', '--workdir', workdir, '--no-backup'], process.env, true)
    .catch(() => console.error('Could not stop the isolated Paddle test project; inspect its temporary project manually.'))
  rmSync(workdir, { recursive: true, force: true })
}
