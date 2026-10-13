import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchBandal } from './helpers/launch'

interface RequestTrace {
  filters: string[][]
  intercepted: string[]
  served: string[]
}

test('native tracking filter bypasses Google authentication and media request workload', async ({}, info) => {
  const bandal = await launchBandal()
  try {
    const profile = await bandal.page.evaluate(() => window.bandal.invoke('browser:saveProfile', {
      name: '네트워크 성능', color: '#397db5', icon: '●'
    }))
    const partition = `persist:bandal-profile-${profile.id}`

    // Capture the production registration before this fresh profile is opened.
    // Delegate its exact filter and policy to Chromium; do not rebuild either
    // from test imports, so this also checks the packaged application.
    await bandal.app.evaluate(({ session }, partition) => {
      const browsingSession = session.fromPartition(partition)
      const trace: RequestTrace = { filters: [], intercepted: [], served: [] }
      ;(globalThis as unknown as { requestTrace: RequestTrace }).requestTrace = trace
      const register = browsingSession.webRequest.onBeforeRequest.bind(browsingSession.webRequest)
      browsingSession.webRequest.onBeforeRequest = ((
        filter: Electron.WebRequestFilter,
        listener: (details: Electron.OnBeforeRequestListenerDetails, callback: (response: Electron.CallbackResponse) => void) => void
      ) => {
        trace.filters.push([...filter.urls])
        register(filter, (details, callback) => {
          trace.intercepted.push(details.url)
          listener(details, callback)
        })
      }) as typeof browsingSession.webRequest.onBeforeRequest
      // Every HTTPS destination is served locally inside the throwaway session.
      // These fixtures never contact Google or use a real account.
      browsingSession.protocol.handle('https', request => {
        trace.served.push(request.url)
        const html = new URL(request.url).pathname === '/tracking-fixture'
        return new Response(html ? '<!doctype html><title>Request workload</title><body>Fixture</body>' : 'fixture', {
          headers: { 'content-type': html ? 'text/html' : 'text/plain', 'access-control-allow-origin': '*' }
        })
      })
    }, partition)

    const tabId = randomUUID()
    const created = await bandal.page.evaluate(({ tabId, profileId }) =>
      window.bandal.invoke('browser:createPage', { tabId, profileId, isPrivate: false, courseId: null }),
    { tabId, profileId: profile.id })
    await bandal.page.evaluate(tabId => window.bandal.invoke('browser:pageAction', {
      tabId, action: 'loadURL', args: ['https://www.youtube.com/tracking-fixture']
    }), tabId)

    const request = (urls: string[]) => bandal.app.evaluate(async ({ webContents }, { id, urls }) =>
      webContents.fromId(id)!.executeJavaScript(`Promise.all(${JSON.stringify(urls)}.map(async url => {
        try { const response = await fetch(url); await response.text(); return { url, ok: response.ok }; }
        catch { return { url, ok: false }; }
      }))`), { id: created.state.id, urls }) as Promise<{ url: string; ok: boolean }[]>
    const trace = () => bandal.app.evaluate(() =>
      (globalThis as unknown as { requestTrace: RequestTrace }).requestTrace)

    const ordinary = [
      'https://accounts.google.com/RotateCookies',
      'https://accounts.youtube.com/accounts/SetSID',
      'https://www.youtube.com/youtubei/v1/account/accounts_list',
      'https://rr1.googlevideo.com/videoplayback'
    ]
    const workload = Array.from({ length: 240 }, (_, index) => `${ordinary[index % ordinary.length]}?fixture=${index}`)
    expect((await request(workload)).every(result => result.ok)).toBe(true)
    const initial = await trace()
    expect(initial.filters).toHaveLength(1)
    expect(initial.intercepted).toEqual([])
    expect(initial.served.filter(url => workload.includes(url))).toHaveLength(workload.length)

    const blocked = [
      'https://doubleclick.net/track',
      'https://ad.doubleclick.net/track',
      'https://doubleclick.net./track',
      'https://ad.doubleclick.net./track'
    ]
    expect(await request(blocked)).toEqual(blocked.map(url => ({ url, ok: false })))
    const lookalikes = ['https://notdoubleclick.net/track', 'https://doubleclick.net.example.com/track']
    expect((await request(lookalikes)).every(result => result.ok)).toBe(true)

    const strictOnly = 'https://pixel.adsrvr.org/track'
    expect(await request([`${strictOnly}?balanced`])).toEqual([{ url: `${strictOnly}?balanced`, ok: true }])
    await bandal.page.evaluate(() => window.bandal.invoke('settings:set', { browser: { trackingProtection: 'strict' } }))
    expect(await request([`${strictOnly}?strict`])).toEqual([{ url: `${strictOnly}?strict`, ok: false }])
    await bandal.page.evaluate(() => window.bandal.invoke('settings:set', { browser: { trackingProtection: 'off' } }))
    expect(await request([`${strictOnly}?off`])).toEqual([{ url: `${strictOnly}?off`, ok: true }])

    const localFile = join(bandal.profileDir, 'blocked-local-fixture.txt')
    writeFileSync(localFile, 'local fixture')
    const localUrl = pathToFileURL(localFile).href
    expect(await bandal.app.evaluate(async ({ session }, { partition, url }) => {
      try { await session.fromPartition(partition).fetch(url); return 'allowed' }
      catch (error) { return String(error) }
    }, { partition, url: localUrl })).toContain('ERR_BLOCKED_BY_CLIENT')

    const final = await trace()
    expect([...final.intercepted].sort()).toEqual([
      ...blocked, `${strictOnly}?balanced`, `${strictOnly}?strict`, `${strictOnly}?off`, localUrl
    ].sort())
    expect(final.filters).toHaveLength(1)
    await info.attach('native-request-filter-workload', {
      body: JSON.stringify({ ordinaryRequests: workload.length, ordinaryCallbacks: initial.intercepted.length,
        trackerCallbacks: final.intercepted.length - 1, blockedFileCallbacks: 1 }),
      contentType: 'application/json'
    })
  } finally {
    await bandal.close()
  }
})
