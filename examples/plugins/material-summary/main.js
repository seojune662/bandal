module.exports = {
  async activate(bandal) {
    let result = await bandal.settings.get('lastSummary')
    bandal.panel.onMessage('summary', async (message) => {
      if (message === 'ready') await bandal.panel.post('summary', result)
      if (message === 'close') await bandal.panel.close('summary')
    })
    bandal.commands.register('preview', async (context) => {
      if (!context) return bandal.notices.show('자료의 문맥 메뉴에서 실행하세요.')
      const text = await bandal.materials.readText(context.courseId, context.relPath)
      const limit = await bandal.settings.get('previewLength')
      result = { path: context.relPath, length: text.length, preview: text.slice(0, limit) }
      await bandal.settings.set('lastSummary', result)
      await bandal.panel.open('summary')
      await bandal.panel.post('summary', result)
    })
  }
}
