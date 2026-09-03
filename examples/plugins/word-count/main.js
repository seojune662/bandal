'use strict'

module.exports = {
  activate(bandal) {
    async function run() {
      const course = await bandal.courses.current()
      if (!course) {
        await bandal.notices.show('현재 선택된 과목이 없습니다.')
        return
      }

      const notes = await bandal.notes.list(course.id)
      const rows = await Promise.all(
        notes.map(async (note) => {
          const loaded = await bandal.notes.read(note.id)
          const text =
            typeof loaded === 'string'
              ? loaded
              : typeof loaded?.content === 'string'
                ? loaded.content
                : typeof loaded?.markdown === 'string'
                  ? loaded.markdown
                  : ''
          const trimmed = text.trim()
          const words = trimmed === '' ? 0 : trimmed.split(/\s+/u).length

          return {
            id: note.id,
            title: note.title || note.relPath || '제목 없는 필기',
            words,
            characters: Array.from(text).length
          }
        })
      )
      const totalWords = rows.reduce((sum, row) => sum + row.words, 0)
      const totalCharacters = rows.reduce(
        (sum, row) => sum + row.characters,
        0
      )
      const payload = {
        course: { id: course.id, name: course.name },
        rows,
        totals: { words: totalWords, characters: totalCharacters }
      }

      await bandal.notices.show(
        `${course.name}: 단어 ${totalWords}개 · 글자 ${totalCharacters}자`
      )
      await bandal.panel.post('stats', payload)
    }

    bandal.commands.register('count-current', run)
    bandal.panel.onMessage('stats', (message) => {
      if (message?.type === 'refresh') void run()
    })
  }
}
