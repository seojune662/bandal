import { describe, expect, test } from 'vitest'
import { synchronizeNoteRename } from '../../../src/renderer/src/features/notes/noteRenameSync'

describe('note rename renderer synchronization', () => {
  test('adopts the canonical title, persisted markdown, and editor markdown', () => {
    const sent = '# 새 제목\n\n본문'
    const renamed = {
      relPath: 'notes/새 제목-2.md',
      mtime: 42,
      title: '새 제목-2',
      markdown: '# 새 제목-2\n\n본문'
    }

    expect(synchronizeNoteRename(sent, sent, renamed)).toEqual({
      currentMarkdown: renamed.markdown,
      persistedMarkdown: renamed.markdown,
      syncedTitle: '새 제목-2',
      dirty: false
    })
  })

  test('keeps a concurrent body edit but advances its H1 to the rename ACK title', () => {
    const sent = '# 새 제목\n\n이전 본문'
    const renamed = {
      relPath: 'notes/새 제목-2.md',
      mtime: 43,
      title: '새 제목-2',
      markdown: '# 새 제목-2\n\n이전 본문'
    }

    expect(
      synchronizeNoteRename('# 새 제목\n\n새 본문', sent, renamed)
    ).toEqual({
      currentMarkdown: '# 새 제목-2\n\n새 본문',
      persistedMarkdown: renamed.markdown,
      syncedTitle: '새 제목-2',
      dirty: true
    })
  })
})
