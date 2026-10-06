import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { launchBandal } from './helpers/launch'

test('plugin constructors, replies, failures and callbacks cannot reach Node or bypass network grants', async () => {
  const app = await launchBandal()
  let requests = 0
  const server = createServer((_request, response) => { requests++; response.end('unexpected') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const folder = join(app.profileDir, 'sandbox-fixture')
  mkdirSync(folder)
  writeFileSync(join(folder, 'manifest.json'), JSON.stringify({
    manifestVersion: 1, id: 'bandal.sandbox-audit', name: 'Sandbox Audit',
    version: '1.0.0', minAppVersion: '0.42.0', author: 'Bandal', description: 'Local isolation regression fixture',
    main: 'main.js', permissions: ['commands', 'courses.read'],
    contributes: { commands: [{ id: 'probe', title: 'Probe' }, { id: 'hang', title: 'Hang' }], panels: [] }
  }))
  writeFileSync(join(folder, 'main.js'), `module.exports = { activate(bandal) {
    bandal.commands.register('hang', () => { setTimeout(() => { while (true) {} }, 20) });
    bandal.commands.register('probe', async (context) => {
      const report = {};
      const probe = (name, value) => {
        try { report[name] = value.constructor.constructor('return typeof process')() }
        catch { report[name] = 'blocked' }
      };
      report.direct = typeof process;
      report.require = typeof require;
      report.electron = typeof globalThis.__bandalHost;
      report.dom = typeof document;
      report.webrtc = typeof RTCPeerConnection;
      probe('module', module); probe('console', console.log); probe('url', URL);
      probe('encoder', new TextEncoder()); probe('api', bandal.courses.list);
      probe('context', context); probe('promise', bandal.courses.list());
      probe('reply', await bandal.courses.list());
      try { await bandal.notes.read('not-granted') } catch (error) { probe('error', error) }
      await new Promise(resolve => setTimeout(() => { probe('timer', setTimeout); resolve() }, 0));
      try { await fetch('http://127.0.0.1:${port}/bypass'); report.network = 'escaped' }
      catch { report.network = 'blocked' }
      try { await fetch('file:///etc/hosts'); report.file = 'escaped' }
      catch { report.file = 'blocked' }
      try { importScripts('http://127.0.0.1:${port}/import'); report.import = 'escaped' }
      catch { report.import = 'blocked' }
      report.forgedOwner = await new Promise(resolve => {
        const received = event => {
          const value = JSON.parse(event.data);
          if (value.t === 'apiResult' && value.id === 90001) resolve('escaped');
        };
        self.addEventListener('message', received);
        self.postMessage(JSON.stringify({ t: 'api', id: 90001, pluginId: 'bandal.some-other-plugin', method: 'courses.list', args: [] }));
        setTimeout(() => { self.removeEventListener('message', received); resolve('blocked') }, 100);
      });
      report.rawPermission = await new Promise(resolve => {
        const received = event => {
          const value = JSON.parse(event.data);
          if (value.t !== 'apiResult' || value.id !== 90002) return;
          self.removeEventListener('message', received);
          resolve(value.ok === false && value.error.code === 'permission-denied' ? 'blocked' : 'escaped');
        };
        self.addEventListener('message', received);
        self.postMessage(JSON.stringify({ t: 'api', id: 90002, pluginId: 'bandal.sandbox-audit', method: 'notes.read', args: ['not-granted'] }));
      });
      report.nestedNetwork = await new Promise(resolve => {
        const url = URL.createObjectURL(new Blob(["fetch('http://127.0.0.1:${port}/nested').then(() => postMessage('escaped'), () => postMessage('blocked'))"], { type: 'text/javascript' }));
        const worker = new Worker(url);
        URL.revokeObjectURL(url);
        worker.onmessage = event => { worker.terminate(); resolve(event.data) };
        worker.onerror = () => { worker.terminate(); resolve('blocked') };
        setTimeout(() => { worker.terminate(); resolve('blocked') }, 500);
      });
      report.socket = await new Promise(resolve => {
        try {
          const socket = new WebSocket('ws://127.0.0.1:${port}/socket');
          socket.onopen = () => { socket.close(); resolve('escaped') };
          socket.onerror = () => resolve('blocked');
          setTimeout(() => { socket.close(); resolve('blocked') }, 100);
        } catch { resolve('blocked') }
      });
      console.log('SANDBOX_REPORT:' + JSON.stringify(report));
    });
  } }`)
  try {
    const windowsBefore = await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
    const activated = await app.page.evaluate(async path => {
      await window.bandal.invoke('plugins:installFromFolder', { path })
      await window.bandal.invoke('plugins:approve', { id: 'bandal.sandbox-audit' })
      return window.bandal.invoke('plugins:setEnabled', { id: 'bandal.sandbox-audit', enabled: true })
    }, folder)
    expect(activated).toMatchObject({ plugin: { state: 'active' } })
    const sandbox = await app.app.evaluate(({ BrowserWindow, webContents }) => {
      const host = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('data:text/html,') && contents.getURL().includes('Bandal%20Plugin%20Host'))
      return { windows: BrowserWindow.getAllWindows().length, preferences: host?.getLastWebPreferences() }
    })
    expect(sandbox.windows).toBe(windowsBefore)
    expect(sandbox.preferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false })
    await app.page.evaluate(() => window.bandal.invoke('plugins:runCommand', { pluginId: 'bandal.sandbox-audit', commandId: 'probe' }))
    const result = await app.page.evaluate(() => window.bandal.invoke('plugins:logs', { id: 'bandal.sandbox-audit' }))
    const entry = result.entries.find(entry => entry.message.startsWith('SANDBOX_REPORT:'))
    expect(entry).toBeDefined()
    const report = JSON.parse(entry!.message.slice('SANDBOX_REPORT:'.length)) as Record<string, string>
    expect(report).toMatchObject({ direct: 'undefined', require: 'undefined', electron: 'undefined', dom: 'undefined', webrtc: 'undefined', network: 'blocked', file: 'blocked', socket: 'blocked', import: 'blocked', forgedOwner: 'blocked', rawPermission: 'blocked', nestedNetwork: 'blocked' })
    for (const key of ['module', 'console', 'url', 'encoder', 'api', 'context', 'promise', 'reply', 'error', 'timer']) expect(['undefined', 'blocked']).toContain(report[key])
    expect(requests).toBe(0)
    // A runaway timer is outside a command promise; the independent main-side
    // watchdog must still end it without closing the application.
    await app.page.evaluate(() => window.bandal.invoke('plugins:runCommand', { pluginId: 'bandal.sandbox-audit', commandId: 'hang' }))
    await expect.poll(async () => {
      const listed = await app.page.evaluate(() => window.bandal.invoke('plugins:list', {}))
      return listed.plugins.find(plugin => plugin.manifest.id === 'bandal.sandbox-audit')?.state
    }, { timeout: 15_000 }).toBe('errored')
    await expect(app.page.locator('aside.app-rail--left:visible')).toBeVisible()
    await app.page.evaluate(() => window.bandal.invoke('plugins:setEnabled', { id: 'bandal.sandbox-audit', enabled: false }))
    expect(await app.app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(contents => contents.getURL().includes('Bandal%20Plugin%20Host')).length)).toBe(0)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    await app.close()
  }
})
