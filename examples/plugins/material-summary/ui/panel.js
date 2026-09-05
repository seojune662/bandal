window.bandal.onMessage((result) => {
  if (!result) return
  document.querySelector('#path').textContent = result.path
  document.querySelector('#count').textContent = `${result.length} 글자`
  document.querySelector('#preview').textContent = result.preview
})
document.querySelector('#close').addEventListener('click', () => window.bandal.postMessage('close'))
window.bandal.postMessage('ready')
