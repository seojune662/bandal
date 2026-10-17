import { randomUUID } from 'node:crypto'

export interface TransitionTarget {
  id: number
  prepare(requestId: string): void
  release(requestId: string): void
  onUnavailable(listener: () => void): () => void
}

/** A renderer may acknowledge only its own pending request. No app transition
 * begins until every current workspace has durably flushed its editor state. */
export function createWorkspaceTransitions(getTargets: () => TransitionTarget[], timeoutMs = 15_000) {
  let active: { id: string; pending: Set<number>; ready: Set<number>; targets: TransitionTarget[];
    resolve(): void; reject(error: Error): void; committing: boolean; cleanups: Array<() => void> } | null = null
  const release = (expectedId?: string): void => {
    const current = active
    if (!current || (expectedId !== undefined && current.id !== expectedId)) return
    active = null
    if (!current.committing) current.reject(new Error('자료 저장과 계정 전환을 취소했습니다.'))
    current.cleanups.forEach(cleanup => cleanup())
    for (const target of current.targets) {
      try { target.release(current.id) } catch { /* The original window may have closed. */ }
    }
  }
  return {
    committing: () => active?.committing === true,
    release,
    acknowledge(senderId: number, requestId: string, ok: boolean): boolean {
      const current = active
      if (!current || current.id !== requestId || !current.pending.has(senderId)) return false
      if (!ok) { current.reject(new Error('열린 자료를 저장하지 못했습니다. 저장 오류를 확인한 뒤 다시 시도해 주세요.')); return true }
      current.pending.delete(senderId); current.ready.add(senderId)
      if (current.pending.size === 0) current.resolve()
      return true
    },
    async run<T>(action: () => Promise<T> | T, retain?: (result: T) => boolean): Promise<T> {
      if (active) throw new Error('자료 저장과 계정 전환이 진행 중입니다. 잠시 후 다시 시도해 주세요.')
      const targets = getTargets()
      let resolve!: () => void, reject!: (error: Error) => void
      const prepared = new Promise<void>((done, failed) => { resolve = done; reject = failed })
      // A target can disappear while another target's send throws, before the
      // normal await is reached. Keep that rejection observed in either path.
      void prepared.catch(() => {})
      const current = { id: randomUUID(), pending: new Set(targets.map(target => target.id)), ready: new Set<number>(), targets,
        resolve, reject, committing: false, cleanups: [] as Array<() => void> }
      active = current
      let retained = false
      try {
        const timeout = setTimeout(() => reject(new Error('열린 자료의 저장 응답을 기다리지 못했습니다. 창의 저장 상태를 확인한 뒤 다시 시도해 주세요.')), timeoutMs)
        current.cleanups.push(() => clearTimeout(timeout))
        for (const target of targets) {
          current.cleanups.push(target.onUnavailable(() => reject(new Error('자료를 저장하던 창이 닫혔습니다. 전환을 중단했습니다.'))))
          target.prepare(current.id)
        }
        if (targets.length === 0) resolve()
        await prepared
        clearTimeout(timeout)
        current.committing = true
        const result = await action()
        retained = retain?.(result) === true
        return result
      } finally { if (!retained) release(current.id) }
    }
  }
}
