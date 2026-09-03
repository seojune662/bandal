'use strict'

const courseName = document.querySelector('#course-name')
const empty = document.querySelector('#empty')
const refresh = document.querySelector('#refresh')
const results = document.querySelector('#results')
const rows = document.querySelector('#rows')
const totalWords = document.querySelector('#total-words')
const totalCharacters = document.querySelector('#total-characters')

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function render(payload) {
  const items = Array.isArray(payload?.rows) ? payload.rows : []
  rows.replaceChildren()

  for (const item of items) {
    const row = document.createElement('tr')
    const title = document.createElement('th')
    const words = document.createElement('td')
    const characters = document.createElement('td')

    title.scope = 'row'
    title.textContent = typeof item.title === 'string' ? item.title : '제목 없는 필기'
    words.textContent = String(number(item.words))
    characters.textContent = String(number(item.characters))
    row.append(title, words, characters)
    rows.append(row)
  }

  courseName.textContent =
    typeof payload?.course?.name === 'string' ? payload.course.name : '단어 수'
  totalWords.textContent = String(number(payload?.totals?.words))
  totalCharacters.textContent = String(number(payload?.totals?.characters))
  empty.hidden = true
  results.hidden = false
}

window.bandal.onMessage(render)
refresh.addEventListener('click', () => {
  window.bandal.postMessage({ type: 'refresh' })
})
