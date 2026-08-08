export const SHARED_NOTE_MARKER = '📒 반달 노트 공유'

const CONTENT_DIVIDER = '--- 노트 내용 ---'

export interface SharedNoteMessage {
  title: string
  courseName: string
  groupName: string
  sharedBy: string
  sharedAt: string
  markdown: string
}

function field(line: string | undefined, label: string): string | null {
  const prefix = `${label}: `
  if (line === undefined || !line.startsWith(prefix)) return null
  const value = line.slice(prefix.length).trim()
  return value === '' ? null : value
}

/** Returns null for ordinary text and for malformed lookalike messages. */
export function parseSharedNoteMessage(body: string | null): SharedNoteMessage | null {
  if (body === null || !body.startsWith(`${SHARED_NOTE_MARKER}\n`)) return null
  const divider = `\n${CONTENT_DIVIDER}\n`
  const dividerIndex = body.indexOf(divider)
  if (dividerIndex < 0) return null
  const header = body.slice(0, dividerIndex).replace(/\r\n/g, '\n').split('\n')
  if (header.length !== 6 || header[0] !== SHARED_NOTE_MARKER) return null

  const title = field(header[1], '제목')
  const courseName = field(header[2], '원래 과목')
  const groupName = field(header[3], '그룹')
  const sharedBy = field(header[4], '공유한 사람')
  const sharedAt = field(header[5], '공유한 날짜')
  if (
    title === null ||
    courseName === null ||
    groupName === null ||
    sharedBy === null ||
    sharedAt === null ||
    Number.isNaN(Date.parse(sharedAt))
  ) {
    return null
  }
  return {
    title,
    courseName,
    groupName,
    sharedBy,
    sharedAt,
    markdown: body.slice(dividerIndex + divider.length)
  }
}

export function sharedNotePreview(markdown: string, maximum = 180): string {
  const preview = markdown.replace(/\s+/g, ' ').trim()
  if (preview === '') return '내용이 없는 노트예요.'
  return preview.length <= maximum ? preview : `${preview.slice(0, maximum).trimEnd()}…`
}
