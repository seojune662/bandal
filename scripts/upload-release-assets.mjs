import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

class ApiError extends Error {
  constructor(message, retryable = false) {
    super(message)
    this.retryable = retryable
  }
}

/** Stream binary bodies with an explicit length; keep credentials out of argv/logs. */
export async function sendRequest({ method, url, token, file, timeout = 240 }) {
  const temporary = await mkdtemp(join(tmpdir(), 'bandal-release-request-'))
  const bodyPath = join(temporary, 'body')
  const headersPath = join(temporary, 'headers')
  try {
    const args = [
      '--http1.1', '--silent', '--show-error', '--connect-timeout', '30',
      '--max-time', String(timeout), '--request', method, '--config', '-',
      '--header', 'Accept: application/vnd.github+json',
      '--header', 'X-GitHub-Api-Version: 2026-03-10',
      '--output', bodyPath, '--dump-header', headersPath, '--write-out', '%{json}',
    ]
    if (file) {
      args.push('--upload-file', file, '--header', 'Expect:', '--header',
        `Content-Type: ${file.endsWith('.zip') ? 'application/zip' : 'application/octet-stream'}`)
    }
    args.push(url)
    const { code, stdout } = await new Promise((done, reject) => {
      const child = spawn('curl', args, { stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = ''
      child.stdout.on('data', (chunk) => { stdout += chunk })
      // Raw curl errors/commands can contain credentials; report structured metrics below.
      child.stderr.resume()
      child.on('error', () => reject(new ApiError('Could not start curl')))
      child.on('close', (code) => done({ code, stdout }))
      child.stdin.on('error', () => {})
      child.stdin.end(`header = ${JSON.stringify(`Authorization: Bearer ${token}`)}\n`)
    })
    const metrics = JSON.parse(stdout || '{}')
    const headers = await readFile(headersPath, 'utf8').catch(() => '')
    return {
      code,
      status: Number(metrics.http_code ?? 0),
      body: await readFile(bodyPath, 'utf8').catch(() => ''),
      requestId: headers.match(/^x-github-request-id:\s*(.+)$/im)?.[1].trim(),
      bytes: Number(metrics.size_upload ?? 0),
      seconds: Number(metrics.time_total ?? 0),
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

export async function describeFile(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return { file, name: basename(file), size: (await stat(file)).size, digest: `sha256:${hash.digest('hex')}` }
}

const matches = (asset, file) => asset?.state === 'uploaded' &&
  asset.name === file.name && asset.size === file.size && asset.digest === file.digest

export function createUploader({ repository, releaseId, token, send = sendRequest, wait = sleep, log = console.log, attempts = 4 }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^\d+$/.test(String(releaseId))) {
    throw new Error('A repository and numeric release ID are required')
  }
  const base = `https://api.github.com/repos/${repository}`

  async function call(method, url, file) {
    const result = await send({ method, url, token, file })
    const diagnostic = `HTTP ${result.status}, curl ${result.code}, ${result.bytes} bytes, ${result.seconds}s${result.requestId ? `, request ${result.requestId}` : ''}`
    if (result.code !== 0) throw new ApiError(`Transport failed (${diagnostic})`, true)
    // A DELETE may have succeeded before its response was lost.
    if (method === 'DELETE' && result.status === 404) return null
    if (result.status < 200 || result.status >= 300) {
      throw new ApiError(`GitHub request failed (${diagnostic})`,
        result.status >= 500 || [408, 422, 429].includes(result.status))
    }
    // GitHub's successful DELETE response has no JSON body.
    if (result.status === 204) return null
    try {
      return JSON.parse(result.body)
    } catch {
      throw new ApiError(`Incomplete GitHub JSON response (${diagnostic})`, true)
    }
  }

  async function retry(label, action) {
    for (let attempt = 1; ; attempt++) {
      try { return await action() } catch (error) {
        if (!error.retryable || attempt >= attempts) throw error
        log(`${label}: attempt ${attempt}/${attempts}: ${error.message}`)
        await wait(Math.min(1000 * 2 ** (attempt - 1), 30_000))
      }
    }
  }

  async function listAssets() {
    const all = []
    for (let page = 1; ; page++) {
      const batch = await retry('List assets', async () => {
        const value = await call('GET', `${base}/releases/${releaseId}/assets?per_page=100&page=${page}`)
        if (!Array.isArray(value)) throw new ApiError('Invalid asset list response', true)
        return value
      })
      all.push(...batch)
      if (batch.length < 100) return all
    }
  }

  async function upload(files) {
    const release = await retry('Read release', async () => {
      const value = await call('GET', `${base}/releases/${releaseId}`)
      if (typeof value?.draft !== 'boolean' || typeof value.upload_url !== 'string') {
        throw new ApiError('Invalid release metadata response', true)
      }
      return value
    })
    const uploadUrl = new URL(release.upload_url.replace(/\{.*$/, ''))
    if (uploadUrl.protocol !== 'https:' || uploadUrl.hostname !== 'uploads.github.com') {
      throw new Error('Unexpected release upload host')
    }
    for (const file of files) {
      const reconcile = async () => (await listAssets()).find((asset) => asset.name === file.name)
      try {
        await retry(file.name, async () => {
          const existing = await reconcile()
          // Re-running a failed publish must preserve already verified installers.
          if (matches(existing, file)) {
            log(`Verified existing ${file.name}`)
            return
          }
          if (!release.draft) throw new Error(`Cannot replace ${file.name} in a published release`)
          if (existing) {
            await retry(`Remove incomplete ${file.name}`, () => call('DELETE', `${base}/releases/assets/${existing.id}`))
          }
          const target = new URL(uploadUrl)
          target.searchParams.set('name', file.name)
          const uploaded = await call('POST', target.href, file.file)
          if (!matches(uploaded, file)) throw new ApiError(`Upload verification failed: ${file.name}`, true)
          log(`Uploaded and verified ${file.name}`)
        })
      } catch (error) {
        // The final upload can complete even if its response times out.
        if (!error.retryable || !matches(await reconcile(), file)) throw error
        log(`Verified completed ${file.name} after a lost response`)
      }
    }
  }
  return { upload }
}

async function main() {
  const directory = resolve(process.argv[2] ?? 'release')
  const names = (await readdir(directory)).filter((name) =>
    /\.(dmg|zip|exe|blockmap)$/.test(name) || /^latest(?:-mac)?\.yml$/.test(name))
  if (names.length === 0) throw new Error('No release assets found')
  // Feed publication follows installer transfer; each remote file is hash checked.
  names.sort((a, b) => Number(a.endsWith('.yml')) - Number(b.endsWith('.yml')) || a.localeCompare(b))
  const files = []
  for (const name of names) files.push(await describeFile(join(directory, name)))
  const token = process.env.GH_TOKEN
  if (!token) throw new Error('GH_TOKEN is required')
  await createUploader({ repository: process.env.GITHUB_REPOSITORY ?? 'seojune662/bandal', releaseId: process.env.RELEASE_ID, token }).upload(files)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
