import { expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { launchBandal } from './helpers/launch'

// Exercise the helper with the installed app's own executable. A Node-only
// unit test cannot detect signing/fuse/Windows .cmd failures in this boundary.
test('Claude browser helper uses the packaged runtime without an installed Node', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bandal-login-runtime-test-'))
  const modulePath = join(directory, 'bridge.cjs')
  writeFileSync(modulePath, ts.transpileModule(
    readFileSync(resolve(__dirname, '../src/main/features/agent/loginBrowserBridge.ts'), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
  ).outputText)
  const bandal = await launchBandal()
  try {
    const result = await bandal.app.evaluate(async ({ app }, modulePath) => {
      const load = process.getBuiltinModule('module').createRequire(`${app.getAppPath()}/package.json`)
      const { createLoginBrowserBridge } = load(modulePath)
      const spawn = load('cross-spawn')
      const fs = process.getBuiltinModule('fs')
      const path = process.getBuiltinModule('path')
      const os = process.getBuiltinModule('os')
      const received: string[] = []
      const unicodeDirectory = fs.mkdtempSync(path.join(app.getPath('temp'), '반달 로그인 '))
      const originalTmpdir = os.tmpdir
      let bridge: Awaited<ReturnType<typeof createLoginBrowserBridge>>
      try {
        os.tmpdir = () => unicodeDirectory
        bridge = await createLoginBrowserBridge((url: string) => received.push(url))
      } finally { os.tmpdir = originalTmpdir }
      const helperDirectory = path.dirname(bridge.browserPath)
      const url = 'https://claude.ai/oauth/authorize?client_id=fixture&state=private-fixture&redirect_uri=http%3A%2F%2Flocalhost%3A8181%2Fcallback'
      try {
        const sources = fs.readdirSync(helperDirectory).map((name: string) => fs.readFileSync(path.join(helperDirectory, name), 'utf8')).join('\n')
        // The helper receives a URL as one argument; ampersands must survive
        // Windows cmd parsing. No Node path is added to its environment.
        const env = { ...process.env }
        delete env.NODE_OPTIONS
        delete env.ELECTRON_RUN_AS_NODE
        env.PATH = process.platform === 'win32' ? `${process.env.SystemRoot}\\System32` : '/usr/bin:/bin'
        if (process.platform === 'win32') delete env.Path
        const code = await new Promise<number | null>((resolve, reject) => {
          const child = spawn(bridge.browserPath, [url], { env, windowsHide: true, stdio: 'pipe' })
          const timer = setTimeout(() => { child.kill(); reject(new Error('Browser helper timed out')) }, 15_000)
          child.once('error', (error: Error) => { clearTimeout(timer); reject(error) })
          child.once('close', (code: number | null) => { clearTimeout(timer); resolve(code) })
        })
        await bridge.dispose()
        return { code, received, expectedUrl: url, containsAuthorization: sources.includes('private-fixture'), removed: !fs.existsSync(helperDirectory) }
      } finally {
        await bridge.dispose()
        fs.rmSync(unicodeDirectory, { recursive: true, force: true })
      }
    }, modulePath)
    expect(result.code).toBe(0)
    expect(result.received).toEqual([result.expectedUrl])
    expect(result.containsAuthorization).toBe(false)
    expect(result.removed).toBe(true)
  } finally {
    await bandal.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
