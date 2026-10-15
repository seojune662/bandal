import { BillingError, object, type BillingEnvironment, type JsonObject } from './policy.ts'

export interface PaddleProvider {
  createTransaction(priceId: string, customerId: string | null, checkoutUrl: string): Promise<JsonObject>
  transaction(id: string): Promise<JsonObject>
  subscription(id: string): Promise<JsonObject>
  cancel(id: string): Promise<JsonObject>
  discardTransaction(id: string): Promise<JsonObject>
  portal(customerId: string): Promise<JsonObject>
  subscriptionTransactions(subscriptionId: string): Promise<JsonObject[]>
}

export function createPaddleProvider(apiKey: string, fetcher: typeof fetch = fetch, environment: BillingEnvironment = 'sandbox'): PaddleProvider {
  const origin = environment === 'live' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com'
  async function call(path: string, body?: JsonObject, method = body ? 'POST' : 'GET', list = false): Promise<JsonObject> {
    let response: Response
    try {
      response = await fetcher(`${origin}${path}`, {
        method,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Paddle-Version': '1' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000)
      })
    } catch { throw new BillingError('provider_unavailable', 503) }
    // Do not echo provider response bodies, request headers, or SDK exceptions.
    if (!response.ok) throw new BillingError(response.status === 429 || response.status >= 500 ? 'provider_unavailable' : 'provider_request_failed', 503)
    try { const data = object(await response.json()).data; return list && Array.isArray(data) ? { transactions: data.map(object) } : object(data) } catch { throw new BillingError('invalid_provider_data', 502) }
  }
  return {
    createTransaction: (priceId, customerId, checkoutUrl) => call('/transactions', {
      items: [{ price_id: priceId, quantity: 1 }], currency_code: 'KRW', collection_mode: 'automatic',
      ...(customerId ? { customer_id: customerId } : {}), checkout: { url: checkoutUrl }
    }),
    transaction: id => call(`/transactions/${encodeURIComponent(id)}?include=adjustments`),
    subscription: id => call(`/subscriptions/${encodeURIComponent(id)}`),
    cancel: id => call(`/subscriptions/${encodeURIComponent(id)}/cancel`, { effective_from: 'next_billing_period' }),
    discardTransaction: id => call(`/transactions/${encodeURIComponent(id)}`, { status: 'canceled' }, 'PATCH'),
    portal: id => call(`/customers/${encodeURIComponent(id)}/portal-sessions`, {}),
    subscriptionTransactions: async id => (await call(`/transactions?subscription_id=${encodeURIComponent(id)}&status=completed&per_page=2&include=adjustments&order_by=created_at%5BDESC%5D`, undefined, 'GET', true)).transactions as JsonObject[]
  }
}
