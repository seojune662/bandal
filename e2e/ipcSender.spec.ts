import { expect, test } from '@playwright/test'
import { launchBandal } from './helpers/launch'

test('app IPC rejects guest views, subframes and foreign documents before side effects', async () => {
  const app = await launchBandal()
  try {
    await app.page.evaluate(() => {
      const frame = document.createElement('iframe')
      frame.id = 'ipc-sender-subframe'
      document.body.append(frame)
    })
    const report = await app.app.evaluate(async ({ BrowserWindow, WebContentsView, ipcMain }) => {
      const main = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('/index.html'))!
      const handlers = (ipcMain as any)._invokeHandlers as Map<string, (...args: any[]) => Promise<unknown>>
      const guest = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
      const foreign = new BrowserWindow({ show: false, webPreferences: {
        preload: main.webContents.getLastWebPreferences().preload,
        sandbox: true, contextIsolation: true, nodeIntegration: false
      } })
      try {
        await guest.webContents.loadURL(main.webContents.getURL())
        const child = main.webContents.mainFrame.frames[0]
        if (!child) throw new Error('Missing subframe probe')
        const events = [
          { sender: guest.webContents, senderFrame: guest.webContents.mainFrame },
          { sender: main.webContents, senderFrame: child },
          { sender: main.webContents, senderFrame: null }
        ]
        let inspectedRequests = 0
        const denied: string[] = []
        const request = new Proxy({}, { get: () => { inspectedRequests++; return undefined } })
        for (const event of events) {
          for (const channel of ['settings:set', 'window:openSettings']) {
            try { await handlers.get(channel)!(event, request); denied.push('allowed') }
            catch (error) { denied.push(String(error)) }
          }
          ipcMain.emit('materials:startDrag', event, request)
        }
        // Even a BrowserWindow with the app preload loses authority after it
        // loads a foreign document. This exercises real renderer IPC.
        await foreign.loadURL('data:text/html,<title>Foreign document</title>')
        const foreignResult = await foreign.webContents.executeJavaScript(`window.bandal.invoke('settings:set', { theme: 'light' }).then(() => 'allowed', error => String(error))`)
        const localPages: string[] = []
        for (const page of ['settings.html', 'overlay.html', 'pip.html?view=toolbar']) {
          await foreign.loadURL(new URL(page, main.webContents.getURL()).href)
          const theme = await foreign.webContents.executeJavaScript(`window.bandal.invoke('settings:get', {}).then(settings => settings.theme)`)
          localPages.push(theme)
        }
        return { denied, inspectedRequests, foreignResult, localPages }
      } finally {
        if (!guest.webContents.isDestroyed()) guest.webContents.close({ waitForBeforeUnload: false })
        foreign.destroy()
      }
    })
    expect(report.denied).toHaveLength(6)
    for (const result of report.denied) expect(result).toContain('IPC sender is not an app renderer')
    expect(report.inspectedRequests).toBe(0)
    expect(report.foreignResult).toContain('IPC sender is not an app renderer')
    expect(report.localPages).toEqual(['dark', 'dark', 'dark'])
    expect(await app.page.evaluate(() => window.bandal.invoke('settings:get', {}).then(settings => settings.theme))).toBe('dark')
  } finally { await app.close() }
})
