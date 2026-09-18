import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createUploader, describeFile, sendRequest } from './upload-release-assets.mjs'

const file = { name: 'Bandal.zip', file: '/tmp/Bandal.zip', size: 123, digest: 'sha256:expected' }
const complete = { ...file, id: 7, state: 'uploaded' }
const release = { draft: true, upload_url: 'https://uploads.github.com/repos/example/app/releases/1/assets{?name,label}' }
const response = (status, body = null, extra = {}) => ({
  status, code: 0, body: body === null ? '' : JSON.stringify(body), bytes: 0, seconds: 1, ...extra,
})

function client(send, extra = {}) {
  return createUploader({ repository: 'example/app', releaseId: '1', token: 'test-token', send,
    wait: async () => {}, log: () => {}, ...extra })
}

test('a resumed publish preserves matching uploaded files', async () => {
  const calls = []
  await client(async ({ method, url }) => {
    calls.push(method)
    return response(200, url.includes('/assets?') ? [complete] : release)
  }).upload([file])
  assert.deepEqual(calls, ['GET', 'GET'])
})

test('malformed and 503 metadata responses are retried', async () => {
  let lists = 0
  await client(async ({ url }) => {
    if (!url.includes('/assets?')) return response(200, release)
    lists++
    if (lists === 1) return response(200, null, { body: '{' })
    if (lists === 2) return response(503)
    return response(200, [complete])
  }).upload([file])
  assert.equal(lists, 3)
})

test('a timed out upload is reconciled before deleting or sending it again', async () => {
  let stored = false
  let posts = 0
  await client(async ({ method, url }) => {
    assert.notEqual(method, 'DELETE')
    if (method === 'POST') {
      posts++
      stored = true
      return response(0, null, { code: 28 })
    }
    return response(200, url.includes('/assets?') ? (stored ? [complete] : []) : release)
  }).upload([file])
  assert.equal(posts, 1)
})

test('an empty 204 delete response is accepted and a starter asset is replaced', async () => {
  let deletes = 0
  let posts = 0
  await client(async ({ method, url }) => {
    if (method === 'DELETE') { deletes++; return response(204) }
    if (method === 'POST') { posts++; return response(201, complete) }
    return response(200, url.includes('/assets?') ? [{ ...complete, state: 'starter' }] : release)
  }).upload([file])
  assert.equal(deletes, 1)
  assert.equal(posts, 1)
})

test('a delete that succeeded before its error response recovers through 404', async () => {
  let deletes = 0
  await client(async ({ method, url }) => {
    if (method === 'DELETE') return response(++deletes === 1 ? 502 : 404)
    if (method === 'POST') return response(201, complete)
    return response(200, url.includes('/assets?') ? [{ ...complete, state: 'starter' }] : release)
  }).upload([file])
  assert.equal(deletes, 2)
})

test('a 500 upload leaving a starter is cleaned up on the next attempt', async () => {
  let stored = null
  let posts = 0
  let deletes = 0
  await client(async ({ method, url }) => {
    if (method === 'DELETE') { deletes++; stored = null; return response(204) }
    if (method === 'POST') {
      stored = ++posts === 1 ? { ...complete, state: 'starter' } : complete
      return response(posts === 1 ? 500 : 201, stored)
    }
    return response(200, url.includes('/assets?') ? (stored ? [stored] : []) : release)
  }).upload([file])
  assert.equal(posts, 2)
  assert.equal(deletes, 1)
})

test('the final lost response is also checked against the server digest', async () => {
  let stored = false
  await client(async ({ method, url }) => {
    if (method === 'POST') { stored = true; return response(0, null, { code: 28 }) }
    return response(200, url.includes('/assets?') ? (stored ? [complete] : []) : release)
  }, { attempts: 1 }).upload([file])
})

test('permission failures stop without retrying or leaking the token', async () => {
  let calls = 0
  await assert.rejects(client(async () => {
    calls++
    return response(403)
  }).upload([file]), (error) => /HTTP 403/.test(error.message) && !error.message.includes('test-token'))
  assert.equal(calls, 1)
})

test('wrong uploaded hashes fail verification', async () => {
  await assert.rejects(client(async ({ method, url }) => {
    if (method === 'POST') return response(201, { ...complete, digest: 'sha256:wrong' })
    return response(200, url.includes('/assets?') ? [] : release)
  }, { attempts: 1 }).upload([file]), /verification failed/)
})

test('published installers are never replaced with different content', async () => {
  await assert.rejects(client(async ({ method, url }) => {
    assert.equal(method, 'GET')
    return response(200, url.includes('/assets?') ? [] : { ...release, draft: false })
  }).upload([file]), /published release/)
})

test('the real transport streams the complete file with Content-Length', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bandal-upload-test-'))
  const path = join(directory, 'installer.zip')
  const data = Buffer.alloc(128 * 1024, 0xa5)
  await writeFile(path, data)
  const descriptor = await describeFile(path)
  let captured
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    captured = { headers: request.headers, data: Buffer.concat(chunks), method: request.method }
    response.writeHead(201, { 'content-type': 'application/json', 'x-github-request-id': 'test-request' })
    response.end(JSON.stringify({ ...descriptor, state: 'uploaded' }))
  })
  try {
    await new Promise((done) => server.listen(0, '127.0.0.1', done))
    const result = await sendRequest({ method: 'POST', url: `http://127.0.0.1:${server.address().port}/assets`, token: 'test-token', file: path })
    assert.equal(result.status, 201)
    assert.equal(result.bytes, data.length)
    assert.equal(result.requestId, 'test-request')
    assert.equal(captured.method, 'POST')
    assert.equal(captured.headers['content-length'], String(data.length))
    assert.equal(captured.headers['content-type'], 'application/zip')
    assert.equal(captured.headers['transfer-encoding'], undefined)
    assert.equal(captured.headers.expect, undefined)
    assert.equal(captured.headers.authorization, 'Bearer test-token')
    assert.deepEqual(captured.data, data)
  } finally {
    await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
  }
})
