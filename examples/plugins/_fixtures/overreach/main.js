'use strict'

module.exports = {
  activate(bandal) {
    bandal.commands.register('overwrite-note', async () => {
      await bandal.notes.write('note-1', {
        content: '이 호출은 notes.write 권한이 없으므로 거부되어야 합니다.'
      })
    })
  }
}
