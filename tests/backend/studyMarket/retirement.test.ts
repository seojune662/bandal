import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createStudyMarketService, type MarketConfig } from '../../../supabase/functions/_shared/study-market/service'

const config: MarketConfig = { supabaseUrl: 'https://example.supabase.co', webOrigin: 'https://bandal.io', environment: 'test', enabled: true, retired: true, clientKey: 'test_ck_x', secretKey: 'test_sk_x', payoutSecretKey: 'test_sk_x', securityKey: '11'.repeat(32), cronSecret: 'x'.repeat(40) }
const request = (action: string, input = {}): Request => new Request('https://example.supabase.co/functions/v1/study-market', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, input })
})

describe('retired study marketplace', () => {
  it('rejects new commerce from old apps before any identity, DB or provider call', async () => {
    const handle = createStudyMarketService({} as SupabaseClient, config, vi.fn())
    for (const action of ['requestUniversity', 'createCourse', 'saveDraft', 'uploadGrant', 'finalizeFile', 'publish', 'registerSeller', 'order']) {
      const response = await handle(request(action))
      expect(response.status).toBe(410)
      expect(await response.json()).toEqual({ error: 'market_retired' })
    }
  })
  it('still verifies a historical checkout capability and returns a paid purchase', async () => {
    const row = { id: '11111111-1111-4111-8111-111111111111', listing_id: 'listing', version_id: 'version', environment: 'test', status: 'paid', title: '기존 구매 자료', amount: 1000, fee: 100, seller_amount: 900 }
    const db = {
      rpc: vi.fn(async () => ({ data: null, error: null })),
      from: (table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === 'study_market_orders' ? row : null, error: null }) }) }) })
    } as unknown as SupabaseClient
    const handle = createStudyMarketService(db, config, vi.fn())
    const response = await handle(request('checkoutSession', { token: 'a'.repeat(43) }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ order: { status: 'paid', title: '기존 구매 자료' } })
  })
})
