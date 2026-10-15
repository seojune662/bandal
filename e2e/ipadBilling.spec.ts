import { expect, test } from '@playwright/test'
import { launchBandal } from './helpers/launch'

test('iPad subscription management opens the public billing page without account secrets', async () => {
  const bandal = await launchBandal()
  try {
    const opened = await bandal.app.evaluate(async ({ Menu, shell }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('ipad-companion-billing')
      if (!item) throw new Error('iPad subscription menu is missing')
      const original = shell.openExternal
      const urls: string[] = []
      try {
        shell.openExternal = async url => { urls.push(url) }
        item.click(undefined as never, undefined as never, undefined as never)
        await Promise.resolve()
        return urls
      } finally { shell.openExternal = original }
    })
    expect(opened).toEqual(['https://bandal.io/billing'])
  } finally { await bandal.close() }
})
