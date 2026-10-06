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
  function fileTarget(options: { marked?: boolean; missing?: boolean; duplicate?: boolean; fail?: boolean } = {}) {
    let marker = ''
    const frame = { executeJavaScript: vi.fn(async (code: string) => {
      marker = /data-bandal-upload-[a-f0-9-]+/.exec(code)?.[0] ?? ''
      return options.marked ?? true
    }) }
    const send = vi.fn(async (method: string) => {
      if (method === 'DOM.getDocument') return { root: { nodeId: 1, children: [
        { nodeId: 10, nodeName: 'INPUT', attributes: ['type', 'file'] },
        { nodeId: 11, nodeName: 'IFRAME', contentDocument: { nodeId: 12, children: options.missing ? [] : [
          { nodeId: 42, nodeName: 'INPUT', attributes: ['type', 'file', marker, ''] },
          ...(options.duplicate ? [{ nodeId: 43, nodeName: 'INPUT', attributes: ['type', 'file', marker, ''] }] : [])
        ] } }
      ] } }
      if (options.fail) throw new Error('attachment failed')
      return {}
    })
    return { ...target({ send }), frame, send }
  }

  test('uses the snapshot ordinal in the requested frame and attaches to that exact input', async () => {
    const { t, frame, send, detach } = fileTarget()
    expect(await setFileInputFiles(t, frame, 7, ['/a/report.pdf'])).toBe(true)
    expect(frame.executeJavaScript.mock.calls[0]?.[0]).toContain('__bandalTargets()[7]')
    expect(frame.executeJavaScript.mock.calls[0]?.[0]).toContain("target.type !== 'file'")
    expect(send).toHaveBeenCalledWith('DOM.getDocument', { depth: -1, pierce: true })
    expect(send).toHaveBeenCalledWith('DOM.setFileInputFiles', { nodeId: 42, files: ['/a/report.pdf'] })
    expect(frame.executeJavaScript.mock.calls[1]?.[0]).toContain('removeAttribute')
    expect(detach).toHaveBeenCalledOnce()
  })

  test.each([{ marked: false }, { missing: true }, { duplicate: true }])('never falls back to another upload input: %j', async (options) => {
    const { t, frame, send } = fileTarget(options)
    expect(await setFileInputFiles(t, frame, 7, ['/a/report.pdf'])).toBe(false)
    expect(send.mock.calls.some(([method]) => method === 'DOM.setFileInputFiles')).toBe(false)
    expect(frame.executeJavaScript.mock.calls.at(-1)?.[0]).toContain('removeAttribute')
  })

  test('removes its temporary marker and detaches when uploading fails', async () => {
    const { t, frame, detach } = fileTarget({ fail: true })
    await expect(setFileInputFiles(t, frame, 7, ['/a/report.pdf'])).rejects.toThrow('attachment failed')
    expect(frame.executeJavaScript.mock.calls.at(-1)?.[0]).toContain('removeAttribute')
    expect(detach).toHaveBeenCalledOnce()
  })

  test('rejects invalid ordinals without evaluating page code', async () => {
    const { t, frame, send } = fileTarget()
    expect(await setFileInputFiles(t, frame, -1, ['/a/report.pdf'])).toBe(false)
    expect(frame.executeJavaScript).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})
