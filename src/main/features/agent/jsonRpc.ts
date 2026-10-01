import type { ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
export type RpcObject = Record<string, any>
export interface RpcMessage { jsonrpc?: string; id?: string | number; method?: string; params?: RpcObject; result?: any; error?: { code?: number; message: string } }
/** Newline-delimited JSON-RPC, shared by Codex App Server and Gemini ACP. */
export function createJsonRpc(child: ChildProcess, receive: (message: RpcMessage) => void, failed: (error: Error) => void) {
  let sequence = 0, closed = false
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout> }>()
  const write = (message: RpcMessage): void => {
    if (closed || !child.stdin?.writable) throw new Error('AI 연결이 닫혔어요. 다시 보내 주세요.')
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
  }
  const stop = (error: Error): void => {
    if (closed) return
    closed = true
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error) }
    pending.clear(); lines?.close(); failed(error)
  }
  const lines = child.stdout ? createInterface({ input: child.stdout }) : null
  lines?.on('line', line => {
    if (!line.trim() || closed) return
    try {
      const message = JSON.parse(line) as RpcMessage
      if (message.method) receive(message)
      else if (typeof message.id === 'number') {
        const item = pending.get(message.id)
        if (!item) return
        pending.delete(message.id); clearTimeout(item.timer)
        if (message.error) item.reject(new Error(message.error.message))
        else item.resolve(message.result)
      }
    } catch (error) { stop(error instanceof Error ? error : new Error('AI 프로토콜 응답 오류')) }
  })
  child.on('error', stop)
  child.on('close', () => stop(new Error('AI 연결이 종료됐어요. 다시 보내면 대화를 이어갈 수 있어요.')))
  child.stdin?.on('error', stop)
  return {
    request(method: string, params: RpcObject, timeoutMs = 30000): Promise<any> {
      const id = ++sequence
      return new Promise((resolve, reject) => {
        const timer = timeoutMs > 0 ? setTimeout(() => { pending.delete(id); reject(new Error(`${method}: AI 응답 시간이 초과됐어요.`)) }, timeoutMs) : undefined
        pending.set(id, { resolve, reject, ...(timer ? { timer } : {}) })
        try { write({ id, method, params }) } catch (error) { pending.delete(id); clearTimeout(timer); reject(error) }
      })
    },
    notify(method: string, params: RpcObject = {}): void { write({ method, params }) },
    respond(id: string | number, result: unknown): void { write({ id, result }) },
    reject(id: string | number, message: string): void { write({ id, error: { code: -32601, message } }) },
    dispose(): void { stop(new Error('AI 연결을 닫았어요.')) }
  }
}
