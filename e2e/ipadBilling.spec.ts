import { expect, test } from '@playwright/test'
import { launchBandal } from './helpers/launch'

test('retired account sync and subscription stay hidden while local iPad transfer remains', async () => {
  const bandal = await launchBandal()
  try {
    const menu = await bandal.app.evaluate(({ Menu }) => {
      const appMenu = Menu.getApplicationMenu()
      const ipad = appMenu?.items.find(item => item.label === 'iPad')
      return { billing: Boolean(appMenu?.getMenuItemById('ipad-companion-billing')), items: ipad?.submenu?.items.map(item => item.label) ?? [] }
    })
    expect(menu).toEqual({ billing: false, items: ['iPad로 자료 내보내기…', 'iPad 자료 가져오기…'] })
    const result = await bandal.page.evaluate(async () => {
      const sync = await window.bandal.invoke('runtime:syncState', {})
      const attempt = async (call: () => Promise<unknown>): Promise<string> => { try { await call(); return 'ok' } catch (error) { return String(error) } }
      return {
        sync,
        billing: await attempt(() => window.bandal.invoke('billing:getState', {})),
        enable: await attempt(() => window.bandal.invoke('runtime:syncSetEnabled', { enabled: true }))
      }
    })
    expect(result.sync).toMatchObject({ available: false, enabled: false })
    expect(result.billing).toContain('구독을 판매하지 않습니다')
    expect(result.enable).toContain('계정 동기화는 종료됐습니다')
  } finally { await bandal.close() }
})
