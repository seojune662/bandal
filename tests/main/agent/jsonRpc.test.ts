import { expect, test, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { createJsonRpc, RpcResponseError } from '../../../src/main/features/agent/jsonRpc'
test('RPC reply errors preserve the method, provider code and diagnostic data', async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() }) as ChildProcess
  const rpc = createJsonRpc(child, () => {}, vi.fn())
  const request = rpc.request('turn/start', {})
  child.stdout!.emit('data', Buffer.from(JSON.stringify({ id: 1, error: { code: -32602, message: 'unsupported model', data: { model: 'selected-model' } } }) + '\n'))
  await expect(request).rejects.toBeInstanceOf(RpcResponseError)
  await expect(request).rejects.toMatchObject({ method: 'turn/start', rpcCode: -32602, message: 'unsupported model', data: { model: 'selected-model' } })
  rpc.dispose()
})
