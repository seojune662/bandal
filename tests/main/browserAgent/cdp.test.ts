import { describe, expect, test, vi } from 'vitest'
import {
  CdpUnavailable,
  insertText,
  setFileInputFiles,
  withDebugger,
  type CdpTarget
} from '../../../src/main/features/browserAgent/cdp'

function target(
  over: {
    attached?: boolean
    attach?: () => void
    send?: (method: string, params?: object) => Promise<unknown>
    detach?: () => void
  } = {}
): { t: CdpTarget; attach: ReturnType<typeof vi.fn>; detach: ReturnType<typeof vi.fn> } {
  const attach = vi.fn(over.attach ?? (() => undefined))
  const detach = vi.fn(over.detach ?? (() => undefined))
  return {
    t: {
      debugger: {
        isAttached: () => over.attached ?? false,
        attach,
        detach,
        sendCommand: over.send ?? (async () => ({}))
      }
    },
    attach,
    detach
  }
}

describe('withDebugger', () => {
  test('attaches, runs, detaches', async () => {
    const { t, attach, detach } = target()
    const result = await withDebugger(t, async () => 'done')
    expect(result).toBe('done')
    expect(attach).toHaveBeenCalledTimes(1)
    expect(detach).toHaveBeenCalledTimes(1)
  })

  test('detaches even when the action throws', async () => {
    // A debugger left attached would break the student's own DevTools and
    // survive into pages the agent has no business on.
    const { t, detach } = target()
    await expect(
      withDebugger(t, async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect(detach).toHaveBeenCalledTimes(1)
  })

  test('refuses when DevTools already owns the debugger', async () => {
    // Only one client may attach; stealing it would be rude and confusing.
    const { t, attach } = target({ attached: true })
    await expect(withDebugger(t, async () => 1)).rejects.toThrow(CdpUnavailable)
    expect(attach).not.toHaveBeenCalled()
  })

  test('a failed attach is CdpUnavailable, so callers can fall back', async () => {
    const { t } = target({
      attach: () => {
        throw new Error('no target')
      }
    })
    await expect(withDebugger(t, async () => 1)).rejects.toThrow(CdpUnavailable)
  })

  test('a failing detach does not mask the result', async () => {
    const { t } = target({
      detach: () => {
        throw new Error('already gone')
      }
    })
    await expect(withDebugger(t, async () => 'ok')).resolves.toBe('ok')
  })
})

describe('insertText', () => {
  test('uses Input.insertText — the reason CDP is here at all', async () => {
    const send = vi.fn(async () => ({}))
    const { t } = target({ send })
    await insertText(t, '해시 충돌')
    expect(send).toHaveBeenCalledWith('Input.insertText', { text: '해시 충돌' })
  })
})

describe('setFileInputFiles', () => {
  test('resolves the node then sets the files', async () => {
    const calls: string[] = []
    const send = vi.fn(async (method: string) => {
      calls.push(method)
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } }
      if (method === 'DOM.querySelector') return { nodeId: 42 }
      return {}
    })
    const { t } = target({ send })
    expect(await setFileInputFiles(t, 'input[type=file]', ['/a/b.pdf'])).toBe(true)
    expect(calls).toEqual([
      'DOM.getDocument',
      'DOM.querySelector',
      'DOM.setFileInputFiles'
    ])
  })

  test('a missing element is false, not a thrown error', async () => {
    const send = vi.fn(async (method: string) => {
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } }
      return { nodeId: 0 }
    })
    const { t } = target({ send })
    expect(await setFileInputFiles(t, 'input[type=file]', ['/a'])).toBe(false)
  })

  test('a document we cannot read is false', async () => {
    const { t } = target({ send: async () => ({}) })
    expect(await setFileInputFiles(t, 'input', ['/a'])).toBe(false)
  })

  test('still detaches after a file attach', async () => {
    const send = vi.fn(async (method: string) =>
      method === 'DOM.getDocument'
        ? { root: { nodeId: 1 } }
        : method === 'DOM.querySelector'
          ? { nodeId: 5 }
          : {}
    )
    const { t, detach } = target({ send })
    await setFileInputFiles(t, 'input', ['/a'])
    expect(detach).toHaveBeenCalledTimes(1)
  })
})
