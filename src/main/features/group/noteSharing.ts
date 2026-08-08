import { basename, extname } from 'node:path'
import type { NotesRepo } from '../notes'
import { ValidationError } from '../../db/errors'
import type { GroupService } from './GroupService'

export const SHARED_NOTE_MARKER = '📒 반달 노트 공유'
export const GROUP_MESSAGE_MAX_CHARS = 4000

const CONTENT_DIVIDER = '--- 노트 내용 ---'
const CONTROL_OR_SEPARATOR = /[/\\\u0000-\u001f\u007f-\u009f\u2028\u2029]/
const FILESYSTEM_HOSTILE = /[:*?"<>|]/g

export interface SharedNoteEnvelope {
  title: string
  courseName: string
  groupName: string
  sharedBy: string
  sharedAt: string
  markdown: string
}

export interface ShareNoteInput {
  groupId: string
  courseId: string
  relPath: string
}

export interface SaveSharedNoteInput {
  courseId: string
  title: string
  markdown: string
}

export interface GroupNoteSharingService {
  shareNote(input: ShareNoteInput): { ok: true }
  saveSharedNote(input: SaveSharedNoteInput): { relPath: string }
}

export interface GroupNoteSharingDeps {
  notesRepo: Pick<NotesRepo, 'read' | 'create' | 'write'>
  /** Kept lazy so creating the IPC router does not start the group runtime. */
  getGroupService: () => Pick<
    GroupService,
    'getAuthState' | 'listGroups' | 'send'
  >
  getCourseName: (courseId: string) => string
  now?: () => Date
}

export class SharedNoteTooLongError extends Error {
  override readonly name = 'SharedNoteTooLongError'

  constructor(
    readonly actual: number,
    readonly maximum = GROUP_MESSAGE_MAX_CHARS
  ) {
    super(
      `[note-too-long] 공유 헤더를 포함해 ${actual.toLocaleString()}자예요. ` +
        `${maximum.toLocaleString()}자 이하로 줄인 뒤 다시 공유해 주세요.`
    )
  }
}

function codePointLength(value: string): number {
  return Array.from(value).length
}

function singleLine(value: string, fallback: string): string {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized === '' ? fallback : normalized
}

function field(line: string | undefined, label: string): string {
  const prefix = `${label}: `
  if (line === undefined || !line.startsWith(prefix)) {
    throw new ValidationError('markdown is not a Bandal shared-note message')
  }
  const value = line.slice(prefix.length).trim()
  if (value === '') {
    throw new ValidationError(`shared-note ${label} is empty`)
  }
  return value
}

/**
 * Rejects separators/control characters before the title reaches notesRepo.
 * Other cross-platform-hostile characters are removed, matching notesRepo's
 * own filename policy while keeping the validation at this untrusted boundary.
 */
export function sanitizeSharedNoteTitle(title: string): string {
  if (typeof title !== 'string' || title.trim() === '') {
    throw new ValidationError('title must be a non-empty string')
  }
  if (CONTROL_OR_SEPARATOR.test(title)) {
    throw new ValidationError('title contains a path separator or control character')
  }
  const cleaned = title
    .trim()
    .replace(FILESYSTEM_HOSTILE, '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .slice(0, 120)
    .trim()
  if (cleaned === '') {
    throw new ValidationError('title has no filesystem-safe characters')
  }
  return cleaned
}

export function formatSharedNoteMessage(input: SharedNoteEnvelope): string {
  const title = singleLine(input.title, '제목 없는 노트')
  const courseName = singleLine(input.courseName, '알 수 없는 과목')
  const groupName = singleLine(input.groupName, '알 수 없는 그룹')
  const sharedBy = singleLine(input.sharedBy, '알 수 없는 사람')
  const sharedAt = singleLine(input.sharedAt, new Date(0).toISOString())
  return [
    SHARED_NOTE_MARKER,
    `제목: ${title}`,
    `원래 과목: ${courseName}`,
    `그룹: ${groupName}`,
    `공유한 사람: ${sharedBy}`,
    `공유한 날짜: ${sharedAt}`,
    CONTENT_DIVIDER,
    input.markdown
  ].join('\n')
}

export function parseSharedNoteMessage(body: string): SharedNoteEnvelope {
  if (typeof body !== 'string') {
    throw new ValidationError('markdown must be a string')
  }
  const divider = `\n${CONTENT_DIVIDER}\n`
  const dividerIndex = body.indexOf(divider)
  if (dividerIndex < 0) {
    throw new ValidationError('markdown is not a Bandal shared-note message')
  }
  const header = body.slice(0, dividerIndex).replace(/\r\n/g, '\n').split('\n')
  if (header.length !== 6 || header[0] !== SHARED_NOTE_MARKER) {
    throw new ValidationError('markdown is not a Bandal shared-note message')
  }
  const sharedAt = field(header[5], '공유한 날짜')
  if (Number.isNaN(Date.parse(sharedAt))) {
    throw new ValidationError('shared-note date is invalid')
  }
  return {
    title: field(header[1], '제목'),
    courseName: field(header[2], '원래 과목'),
    groupName: field(header[3], '그룹'),
    sharedBy: field(header[4], '공유한 사람'),
    sharedAt,
    markdown: body.slice(dividerIndex + divider.length)
  }
}

function savedMarkdown(note: SharedNoteEnvelope): string {
  const source = [
    '> 반달에서 받은 공유 노트',
    `> 그룹: ${singleLine(note.groupName, '알 수 없는 그룹')}`,
    `> 공유한 사람: ${singleLine(note.sharedBy, '알 수 없는 사람')}`,
    `> 공유한 날짜: ${singleLine(note.sharedAt, '알 수 없는 날짜')}`,
    `> 원래 과목: ${singleLine(note.courseName, '알 수 없는 과목')}`
  ].join('\n')
  return `${source}\n\n${note.markdown}`
}

export function createGroupNoteSharingService(
  deps: GroupNoteSharingDeps
): GroupNoteSharingService {
  const now = deps.now ?? (() => new Date())

  return {
    shareNote(input) {
      const groupService = deps.getGroupService()
      const group = groupService
        .listGroups()
        .find((candidate) => candidate.id === input.groupId)
      if (group === undefined) {
        throw new ValidationError(`unknown group ${input.groupId}`)
      }
      const profile = groupService.getAuthState().profile
      if (profile?.nickname === null || profile?.nickname === undefined) {
        throw new ValidationError('a nickname is required to share a note')
      }

      const note = deps.notesRepo.read({
        courseId: input.courseId,
        relPath: input.relPath
      })
      const rawTitle = basename(input.relPath, extname(input.relPath))
      const title = sanitizeSharedNoteTitle(rawTitle)
      const body = formatSharedNoteMessage({
        title,
        courseName: deps.getCourseName(input.courseId),
        groupName: group.name,
        sharedBy: profile.nickname,
        sharedAt: now().toISOString(),
        markdown: note.markdown
      })
      const length = codePointLength(body)
      if (length > GROUP_MESSAGE_MAX_CHARS) {
        // Deliberately reject before `send`: no silent truncation and no
        // partial multi-message note competing with the token bucket.
        throw new SharedNoteTooLongError(length)
      }

      groupService.send(input.groupId, body)
      return { ok: true }
    },

    saveSharedNote(input) {
      const requestedTitle = sanitizeSharedNoteTitle(input.title)
      const shared = parseSharedNoteMessage(input.markdown)
      const embeddedTitle = sanitizeSharedNoteTitle(shared.title)
      if (requestedTitle !== embeddedTitle) {
        throw new ValidationError('title does not match the shared note')
      }

      // Root-only creation plus notesRepo's resolveInside guard keeps the
      // result inside this course. notesRepo.create also chooses -2/-3 on a
      // collision instead of overwriting an existing note.
      const created = deps.notesRepo.create({
        courseId: input.courseId,
        dirRelPath: '',
        title: requestedTitle
      })
      deps.notesRepo.write({
        courseId: input.courseId,
        relPath: created.relPath,
        markdown: savedMarkdown(shared)
      })
      return { relPath: created.relPath }
    }
  }
}
