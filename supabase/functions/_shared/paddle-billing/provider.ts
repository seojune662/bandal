import { BillingError, object, type JsonObject } from './policy.ts'

export interface PaddleProvider {
  createTransaction(priceId: string, customerId: string | null, checkoutUrl: string): Promise<JsonObject>
  transaction(id: string): Promise<JsonObject>
  subscription(id: string): Promise<JsonObject>
  cancel(id: string): Promise<JsonObject>
}

export function createPaddleProvider(apiKey: string, fetcher: typeof fetch = fetch): PaddleProvider {
  async function call(path: string, body?: JsonObject): Promise<JsonObject> {
    let response: Response
    try {
      response = await fetcher(`https://sandbox-api.paddle.com${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Paddle-Version': '1' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000)
      })
    } catch { throw new BillingError('provider_unavailable', 503) }
    // Do not echo provider response bodies, request headers, or SDK exceptions.
    if (!response.ok) throw new BillingError(response.status === 429 || response.status >= 500 ? 'provider_unavailable' : 'provider_request_failed', 503)
    try { return object(object(await response.json()).data) } catch { throw new BillingError('invalid_provider_data', 502) }
  }
  return {
    createTransaction: (priceId, customerId, checkoutUrl) => call('/transactions', {
      items: [{ price_id: priceId, quantity: 1 }], currency_code: 'KRW', collection_mode: 'automatic',
      ...(customerId ? { customer_id: customerId } : {}), checkout: { url: checkoutUrl }
    }),
    transaction: id => call(`/transactions/${encodeURIComponent(id)}`),
    subscription: id => call(`/subscriptions/${encodeURIComponent(id)}`),
    cancel: id => call(`/subscriptions/${encodeURIComponent(id)}/cancel`, { effective_from: 'next_billing_period' })
  }
}
