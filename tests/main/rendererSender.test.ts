import { expect, test } from 'vitest'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isAppRendererSender, isAppRendererUrl } from '../../src/main/ipc/rendererSender'

const rendererDirectory = join(process.cwd(), 'out', 'renderer')
const policy = { rendererDirectory }
const file = (page: string) => pathToFileURL(join(rendererDirectory, page)).href

test.each(['index.html', 'settings.html', 'overlay.html', 'pip.html'])('permits the exact %s app file with view query and hash', page => {
  expect(isAppRendererUrl(`${file(page)}?view=toolbar#selection`, policy)).toBe(true)
})
test.each(['about:blank', 'data:text/html,index.html', 'bandal-plugin://example/index.html', 'https://example.test/index.html', `${file('../index.html')}`, `${file('assets/index.html')}`, `${file('index.html.bak')}`, `${file('..')}/other/index.html`])('rejects a non-app document %s', url => {
  expect(isAppRendererUrl(url, policy)).toBe(false)
})
test('development permits only the configured origin and exact document path', () => {
  const development = { ...policy, developmentUrl: 'http://localhost:5173/dev' }
  expect(isAppRendererUrl('http://localhost:5173/dev/index.html?query=1', development)).toBe(true)
  expect(isAppRendererUrl('http://localhost:5173/dev/pip.html?view=toolbar', development)).toBe(true)
  for (const url of ['http://localhost:5173/', 'http://localhost:5173/other/index.html', 'http://localhost:5173/dev/foreign.html', 'http://127.0.0.1:5173/dev/index.html', 'http://localhost:5174/dev/index.html', 'https://localhost:5173/dev/index.html', 'http://user:pass@localhost:5173/dev/index.html']) expect(isAppRendererUrl(url, development)).toBe(false)
})
test('rejects guest views and subframes even when they load an allowed app file', () => {
  const mainFrame = { url: file('index.html') }
  const sender = { mainFrame, isDestroyed: () => false }
  const owner = { webContents: sender, isDestroyed: () => false }
  expect(isAppRendererSender({ sender, senderFrame: mainFrame }, () => owner, policy)).toBe(true)
  expect(isAppRendererSender({ sender, senderFrame: { url: mainFrame.url } }, () => owner, policy)).toBe(false)
  expect(isAppRendererSender({ sender, senderFrame: null }, () => owner, policy)).toBe(false)
  expect(isAppRendererSender({ sender, senderFrame: mainFrame }, () => null, policy)).toBe(false)
  expect(isAppRendererSender({ sender, senderFrame: mainFrame }, () => ({ ...owner, webContents: { ...sender } }), policy)).toBe(false)
  expect(isAppRendererSender({ sender, senderFrame: mainFrame }, () => ({ ...owner, isDestroyed: () => true }), policy)).toBe(false)
  expect(isAppRendererSender({ sender: { ...sender, isDestroyed: () => true }, senderFrame: mainFrame }, () => owner, policy)).toBe(false)
  mainFrame.url = 'https://example.test/index.html'
  expect(isAppRendererSender({ sender, senderFrame: mainFrame }, () => owner, policy)).toBe(false)
})
