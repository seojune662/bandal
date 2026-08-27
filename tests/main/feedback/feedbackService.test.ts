import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  FEEDBACK_BODY_LIMIT,
  FEEDBACK_RATE_ACTION,
  createFeedbackRateGuard,
  createFeedbackService,
  type FeedbackServiceDeps
} from '../../../src/main/features/feedback/feedbackService'

const REQUEST = {
  kind: 'bug' as const,
  body: '재현할 때 강의 탭이 닫혀요.',
  includeAppInfo: true
}

function fakeClient(
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>
): SupabaseClient {
  return { rpc: vi.fn(rpc) } as unknown as SupabaseClient
}

function deps(
  client: SupabaseClient | null,
  overrides: Partial<FeedbackServiceDeps> = {}
): FeedbackServiceDeps {
  return {
    getClient: () => client,
    rateGuard: {
      take: vi.fn(() => ({ allowed: true, retryAfter: 0 }))
    },
    appVersion: '0.27.0',
    platform: 'darwin',
    getPalette: () => 'bandal',
    ...overrides
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createFeedbackService', () => {
  test('returns unavailable before consuming rate budget when no client exists', async () => {
    const rateGuard = {
      take: vi.fn(() => ({ allowed: true, retryAfter: 0 }))
    }
    const service = createFeedbackService(deps(null, { rateGuard }))

    await expect(service.send(REQUEST)).resolves.toEqual({
      ok: false,
      reason: 'unavailable'
    })
    expect(rateGuard.take).not.toHaveBeenCalled()
  })

  test('locally limits the fourth request in one minute without another RPC', async () => {
    const client = fakeClient(async () => ({ data: null, error: null }))
    const service = createFeedbackService(
      deps(client, { rateGuard: createFeedbackRateGuard() })
    )

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(service.send(REQUEST)).resolves.toEqual({ ok: true })
    }
    await expect(service.send(REQUEST)).resolves.toEqual({
      ok: false,
      reason: 'rate-limited'
    })
    expect(client.rpc).toHaveBeenCalledTimes(3)
  })

  test('submits bounded content and optional app metadata to the feedback RPC', async () => {
    const client = fakeClient(async () => ({ data: null, error: null }))
    const rateGuard = {
      take: vi.fn(() => ({ allowed: true, retryAfter: 0 }))
    }
    const service = createFeedbackService(deps(client, { rateGuard }))
    const longBody = '가'.repeat(FEEDBACK_BODY_LIMIT + 25)

    await expect(
      service.send({ kind: 'feature', body: longBody, includeAppInfo: false })
    ).resolves.toEqual({ ok: true })
    await expect(
      service.send({
        kind: 'friction',
        body: '탭 전환이 조금 불편해요.',
        includeAppInfo: true
      })
    ).resolves.toEqual({ ok: true })

    expect(rateGuard.take).toHaveBeenCalledWith(FEEDBACK_RATE_ACTION)
    expect(client.rpc).toHaveBeenNthCalledWith(1, 'submit_feedback', {
      p_kind: 'feature',
      p_body: '가'.repeat(FEEDBACK_BODY_LIMIT),
      p_app_version: null,
      p_os: 'darwin',
      p_palette: 'bandal'
    })
    expect(client.rpc).toHaveBeenNthCalledWith(2, 'submit_feedback', {
      p_kind: 'friction',
      p_body: '탭 전환이 조금 불편해요.',
      p_app_version: '0.27.0',
      p_os: 'darwin',
      p_palette: 'bandal'
    })
  })

  test('maps the server rate-limit code to the public rate-limited reason', async () => {
    const client = fakeClient(async () => ({
      data: null,
      error: { code: 'P0001', message: 'rate_limited' }
    }))
    const service = createFeedbackService(deps(client))

    await expect(service.send(REQUEST)).resolves.toEqual({
      ok: false,
      reason: 'rate-limited'
    })
  })

  test('does not write feedback content to logs when submission fails', async () => {
    const privateBody = '로그에 절대 남으면 안 되는 본문 7b2d'
    const client = fakeClient(async () => ({
      data: null,
      error: { code: 'XX000', message: privateBody, details: privateBody }
    }))
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const service = createFeedbackService(deps(client))

    await expect(
      service.send({ ...REQUEST, body: privateBody })
    ).resolves.toEqual({ ok: false, reason: 'unavailable' })

    expect(log).toHaveBeenCalledWith('[feedback] submit_feedback unavailable')
    expect(JSON.stringify(log.mock.calls)).not.toContain(privateBody)
  })
})
