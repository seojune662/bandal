import { randomUUID } from 'node:crypto'
import { copyFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import type { SaveDialogOptions, SaveDialogReturnValue } from 'electron'

interface MaterialRef { courseId: string; relPath: string }
interface ExportMaterialDeps {
  resolvePath: (courseId: string, relPath: string) => Promise<string>
  chooseDestination: (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>
}

async function publishMaterialFile(destination: string, write: (temporaryPath: string) => Promise<void>): Promise<void> {
  const temporaryPath = join(dirname(destination), `.bandal-export-${randomUUID()}.tmp`)
  try {
    await write(temporaryPath)
    await rename(temporaryPath, destination)
  } finally {
    await unlink(temporaryPath).catch(() => {})
  }
}

/** Choose first: canceling a generated export must not create course materials. */
export async function shareGeneratedMaterial(input: {
  title: string
  extension: string
  render: () => Promise<Uint8Array | string>
}, deps: Pick<ExportMaterialDeps, 'chooseDestination'>): Promise<{ savedPath: string | null }> {
  const stem = input.title.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '-').trim() || '자료'
  const result = await deps.chooseDestination({
    title: '자료 내보내기', defaultPath: `${stem}.${input.extension}`,
    filters: [{ name: input.extension.toUpperCase(), extensions: [input.extension] }]
  })
  if (result.canceled || !result.filePath) return { savedPath: null }
  const bytes = await input.render()
  await publishMaterialFile(result.filePath, temporaryPath => writeFile(temporaryPath, bytes, { flag: 'wx' }))
  return { savedPath: result.filePath }
}

/** Copy on disk so large audio/video files never cross the renderer bridge. */
export async function exportMaterial(ref: MaterialRef, deps: ExportMaterialDeps): Promise<{ savedPath: string | null }> {
  const source = await deps.resolvePath(ref.courseId, ref.relPath)
  if (!(await stat(source)).isFile()) throw new Error('파일만 내보낼 수 있어요.')
  const extension = extname(source).slice(1)
  const result = await deps.chooseDestination({
    title: '자료 내보내기', defaultPath: basename(source),
    ...(extension ? { filters: [{ name: extension.toUpperCase(), extensions: [extension] }] } : {})
  })
  if (result.canceled || !result.filePath) return { savedPath: null }
  // The chooser can stay open while the material is renamed. Revalidate its
  // course boundary before copying, and never overwrite the original file.
  const currentSource = await deps.resolvePath(ref.courseId, ref.relPath)
  const [realSource, realDestination] = await Promise.all([
    realpath(currentSource),
    realpath(result.filePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return resolve(result.filePath!)
    })
  ])
  if (realSource === realDestination) throw new Error('원본과 다른 위치나 이름으로 내보내 주세요.')
  await publishMaterialFile(result.filePath, temporaryPath => copyFile(currentSource, temporaryPath))
  return { savedPath: result.filePath }
}
