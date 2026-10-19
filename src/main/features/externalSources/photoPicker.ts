import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { app, dialog } from 'electron'

export function createPhotoPicker() {
  const exports = new Set<string>()
  let pending: Promise<string[]> | null = null
  let child: ReturnType<typeof execFile> | null = null
  async function pick(): Promise<string[]> {
    if (process.platform !== 'darwin') {
      const selection = await dialog.showOpenDialog({ title: '사진 선택', properties: ['openFile', 'multiSelections'],
        filters: [{ name: '사진', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'] }] })
      return selection.canceled ? [] : selection.filePaths
    }
    const executable = app.isPackaged
      ? join(process.resourcesPath, 'photo-picker', 'bandal-photo-picker')
      : join(app.getAppPath(), 'resources', 'native', 'photo-picker', process.arch, 'bandal-photo-picker')
    if (!existsSync(executable)) throw new Error('사진 선택 도구를 찾지 못했습니다. 앱을 다시 설치해 주세요.')
    const destination = mkdtempSync(join(app.getPath('temp'), 'bandal-photos-'))
    exports.add(destination)
    try {
      const result = await new Promise<string>((resolve, reject) => {
        child = execFile(executable, [destination], { timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
          child = null
          if (error) reject(new Error('사진을 가져오지 못했습니다. 사진 선택을 다시 열어 주세요.'))
          else resolve(stdout)
        })
      })
      const data: unknown = JSON.parse(result)
      if (!Array.isArray(data)) throw new Error('사진 선택 결과를 읽지 못했습니다.')
      const root = realpathSync(destination)
      const selected = data.filter((path): path is string => typeof path === 'string').slice(0, 100).map(path => {
        const actual = realpathSync(path)
        const inside = relative(root, actual)
        if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) throw new Error('사진 경로가 올바르지 않습니다.')
        return actual
      })
      for (const previous of exports) {
        if (selected.length ? previous !== destination : previous === destination) {
          rmSync(previous, { recursive: true, force: true })
          exports.delete(previous)
        }
      }
      return selected
    } catch (error) {
      rmSync(destination, { recursive: true, force: true })
      exports.delete(destination)
      throw error
    }
  }
  return {
    pick(): Promise<string[]> {
      if (pending) return pending
      pending = pick().finally(() => { pending = null })
      return pending
    },
    dispose(): void {
      child?.kill()
      for (const path of exports) rmSync(path, { recursive: true, force: true })
      exports.clear()
    }
  }
}
