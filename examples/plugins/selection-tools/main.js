module.exports = {
  async activate(bandal) {
    // Reading configuration during activation is supported.
    await bandal.settings.get('case')
    bandal.commands.register('transform', async () => {
      const selection = await bandal.editor.getSelection()
      if (!selection || !selection.text) return bandal.notices.show('필기에서 텍스트를 선택하세요.')
      const mode = await bandal.settings.get('case')
      const text = mode === 'lowercase' ? selection.text.toLocaleLowerCase() : selection.text.toLocaleUpperCase()
      await bandal.editor.replaceSelection(selection.token, text)
    })
  }
}
