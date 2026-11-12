import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ShareTabOutcome, ShareTabTarget } from '../../../shared/ipc/contract'
import { normalizeHttpUrl } from '../../../shared/universities/courseLink'
import { ValidationError } from '../../db/errors'
import { requireId, requireNonEmptyString } from '../../db/validate'

export type ShareSheetItem = { filePaths: string[] } | { urls: string[] }

interface ShareSheetDeps {
  /** The native share menu exists only on macOS; elsewhere links are copied and files revealed. */
  hasShareMenu: boolean
  /** Guarded course path (rejects traversal out of the course folder). */
  resolvePath: (courseId: string, relPath: string) => Promise<string>
  exportAnnotatedPdf: (input: { courseId: string; relPath: string }, savePath: string) => Promise<void>
  /** Folder for generated copies (the PDF with its ink and highlights). */
  tempRoot: string
  copyText: (text: string) => void
  reveal: (path: string) => void
}

/** Shares what the open tab shows: the file itself, or the page's link. */
export function createShareSheet(deps: ShareSheetDeps): (target: ShareTabTarget, showMenu: (item: ShareSheetItem) => void) => Promise<ShareTabOutcome> {
  // A receiving app (Mail, AirDrop) may read the copy after the menu closes,
  // so a generated copy lives until the next share replaces it.
  let lastCopy: string | null = null

  const annotatedCopy = async (courseId: string, relPath: string, source: string): Promise<string> => {
    if (lastCopy !== null) await rm(lastCopy, { recursive: true, force: true })
    lastCopy = join(deps.tempRoot, randomUUID())
    await mkdir(lastCopy, { recursive: true })
    const path = join(lastCopy, basename(source))
    await deps.exportAnnotatedPdf({ courseId, relPath }, path)
    return path
  }

  return async (target, showMenu) => {
    if (target?.kind === 'url') {
      const url = normalizeHttpUrl(target.url)
      if (url === null) throw new ValidationError('url must be an http(s) URL')
      if (!deps.hasShareMenu) { deps.copyText(url); return 'copied' }
      showMenu({ urls: [url] })
      return 'menu'
    }
    if (target?.kind !== 'file') throw new ValidationError('share target must be a file or a url')
    const courseId = requireId(target.courseId, 'courseId')
    const relPath = requireNonEmptyString(target.relPath, 'relPath')
    const source = await deps.resolvePath(courseId, relPath)
    const path = target.annotatedPdf === true ? await annotatedCopy(courseId, relPath, source) : source
    if (!deps.hasShareMenu) { deps.reveal(path); return 'revealed' }
    showMenu({ filePaths: [path] })
    return 'menu'
  }
}
