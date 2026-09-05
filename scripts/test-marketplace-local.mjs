import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const workdir = mkdtempSync(join(tmpdir(), 'bandal-marketplace-check-'))
const project = `bandal-marketplace-${workdir.split('-').at(-1).toLowerCase()}`
const root = resolve(import.meta.dirname, '..')
mkdirSync(join(workdir, 'supabase', 'migrations'), { recursive: true })
writeFileSync(
  join(workdir, 'supabase', 'config.toml'),
  `project_id = "${project}"
[api]
enabled = true
port = 56521
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
[db]
port = 56522
shadow_port = 56520
major_version = 17
[db.seed]
enabled = false
[auth]
enabled = true
site_url = "http://127.0.0.1:56521"
enable_signup = true
[auth.email]
enable_signup = true
enable_confirmations = false
[storage]
enabled = true
file_size_limit = "8MiB"
[analytics]
enabled = false
`,
)
copyFileSync(
  join(root, 'supabase/migrations/20260905000000_marketplace.sql'),
  join(workdir, 'supabase/migrations/20260905000000_marketplace.sql'),
)
async function run(command, args, env = process.env, quiet = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: quiet ? 'ignore' : 'inherit',
    })
    // Supabase diagnostics can include credentials even on failure. Keep
    // both startup and cleanup output private, including error messages.
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `${command} exited ${code}${quiet ? ' (service diagnostics withheld to protect local credentials)' : ''}`,
            ),
          ),
    )
  })
}
try {
  console.info(
    'Starting an isolated marketplace test stack on ports 56520–56522…',
  )
  await run(
    'supabase',
    [
      'start',
      '--workdir',
      workdir,
      '--exclude',
      'realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor',
    ],
    process.env,
    true,
  )
  await run(
    'pnpm',
    ['exec', 'vitest', 'run', 'tests/marketplace/integration.test.ts'],
    { ...process.env, BANDAL_MARKETPLACE_TEST_DIR: workdir },
  )
} finally {
  await run(
    'supabase',
    ['stop', '--workdir', workdir, '--no-backup'],
    process.env,
    true,
  ).catch((error) => console.error(error.message))
  rmSync(workdir, { recursive: true, force: true })
}
