import { basename } from 'node:path'
import type {
  SendHighlightToNoteInput,
  SendHighlightToNoteResult
} from '../../../shared/types/link'
import type { NoteContent } from '../../../shared/types/note'
import { NotFoundError, ValidationError } from '../../db/errors'
import type { NotesRepo } from '../notes'
import { createMaterialLink, parseMaterialLink } from './materialLink'

export interface LinkServiceDeps {
  notes: Pick<NotesRepo, 'read' | 'write' | 'create'>
  getCourseFolder: (courseId: string) => string
}

export interface LinkService {
  sendHighlightToNote(
    input: SendHighlightToNoteInput
  ): SendHighlightToNoteResult
}

const LINK_URL_PATTERN = /bandal:\/\/material\/?\?[^\s)>]+/g
const LINK_LABEL_QUOTE_LIMIT = 80

function safeNoteTitle(title: string): string {
  const safe = title
    .trim()
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .slice(0, 120)
    .trim()
  return safe.length > 0 ? safe : '학습노트'
}

/** Pure default-title rule; exported so the filename rule stays assertable. */
export function defaultStudyNoteTitle(courseFolder: string): string {
  const folderName = basename(courseFolder).trim()
  const courseName = folderName.length > 0 ? folderName : '과목'
  return safeNoteTitle(`${courseName} 학습노트`)
}

function quoteLabel(quote: string): string {
  const oneLine = quote.replace(/\s+/g, ' ').trim()
  const shortened =
    oneLine.length <= LINK_LABEL_QUOTE_LIMIT
      ? oneLine
      : `${oneLine.slice(0, LINK_LABEL_QUOTE_LIMIT - 1).trimEnd()}…`
  return shortened.replace(/([\\\[\]])/g, '\\$1')
}

/** Pure markdown rendering for one appended highlight entry. */
export function highlightMarkdown(input: SendHighlightToNoteInput): string {
  const href = createMaterialLink({
    relPath: input.relPath,
    page: input.page,
    annotationId: input.annotationId
  })
  const quote = input.quote
    .replace(/\r\n?/g, '\n')
    .trim()
    .split('\n')
    .map((line) => (line.length > 0 ? `> ${line}` : '>'))
    .join('\n')
  const comment = input.comment?.trim() ?? ''
  const source = `[${input.page}쪽 "${quoteLabel(input.quote)}"](${href})`
  return [quote, comment, source].filter((part) => part.length > 0).join('\n\n')
}

/** Pure duplicate check based on the annotation id embedded in link URLs. */
export function hasAnnotationLink(
  markdown: string,
  annotationId: string
): boolean {
  for (const match of markdown.matchAll(LINK_URL_PATTERN)) {
    const parsed = parseMaterialLink(match[0])
    if (parsed?.annotationId === annotationId) return true
  }
  return false
}

/** Pure append operation which preserves every existing byte as a prefix. */
export function appendMarkdown(markdown: string, block: string): string {
  if (markdown.length === 0) return `${block}\n`
  const separator = markdown.endsWith('\n\n')
    ? ''
    : markdown.endsWith('\n')
      ? '\n'
      : '\n\n'
  return `${markdown}${separator}${block}\n`
}

function validateInput(input: SendHighlightToNoteInput): void {
  if (!Number.isSafeInteger(input.page) || input.page < 1) {
    throw new ValidationError('page must be a positive integer')
  }
  if (typeof input.relPath !== 'string' || input.relPath.length === 0) {
    throw new ValidationError('relPath must be a non-empty string')
  }
  if (typeof input.quote !== 'string' || input.quote.trim().length === 0) {
    throw new ValidationError('quote must be a non-empty string')
  }
  if (
    typeof input.annotationId !== 'string' ||
    input.annotationId.trim().length === 0
  ) {
    throw new ValidationError('annotationId must be a non-empty string')
  }
  if (input.comment !== null && typeof input.comment !== 'string') {
    throw new ValidationError('comment must be a string or null')
  }
}

export function createLinkService(deps: LinkServiceDeps): LinkService {
  function defaultNote(courseId: string): {
    note: NoteContent
    created: boolean
  } {
    const title = defaultStudyNoteTitle(deps.getCourseFolder(courseId))
    const expectedRelPath = `${title}.md`
    try {
      return {
        note: deps.notes.read({ courseId, relPath: expectedRelPath }),
        created: false
      }
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error
    }

    // create() owns sanitizing and the numeric suffix collision rule. The
    // second read also gives us the mtime used for a non-destructive write.
    const createdRef = deps.notes.create({ courseId, dirRelPath: '', title })
    return { note: deps.notes.read(createdRef), created: true }
  }

  return {
    sendHighlightToNote(input) {
      validateInput(input)
      const target =
        input.noteRelPath === undefined
          ? defaultNote(input.courseId)
          : {
              note: deps.notes.read({
                courseId: input.courseId,
                relPath: input.noteRelPath
              }),
              created: false
            }

      if (hasAnnotationLink(target.note.markdown, input.annotationId)) {
        return { relPath: target.note.relPath, created: target.created }
      }

      deps.notes.write({
        courseId: input.courseId,
        relPath: target.note.relPath,
        markdown: appendMarkdown(target.note.markdown, highlightMarkdown(input)),
        expectedMtime: target.note.mtime
      })
      return { relPath: target.note.relPath, created: target.created }
    }
  }
}

