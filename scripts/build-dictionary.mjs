/** Developer-only regeneration. Packaging uses the committed database, with no network access. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import JSZip from 'jszip'
import { JSDOM } from 'jsdom'
import Database from 'better-sqlite3-node'

const directory = fileURLToPath(new URL('../resources/dictionary/', import.meta.url))
const datasetVersion = 'koreader-dicts-en-ko-v1.2.0'
const sourceUrl = 'https://github.com/DanielGregorini/koreader-dicts/releases/download/v1.2.0/en-ko.zip'
const sourceSha256 = '219eacf3f57e93da993a9ba438d3c3eaf3fa3b94de745847fe74826cb776ccf1'
const sha256 = data => createHash('sha256').update(data).digest('hex')
const key = value => value.normalize('NFKC').replace(/[‘’]/g, "'").replace(/[‐‑–—]/g, '-').toLowerCase().replace(/\s+/g, ' ').trim()
const posNames = { 'n.': '명사', 'v.': '동사', 'adj.': '형용사', 'adv.': '부사', 'pron.': '대명사', 'prep.': '전치사', 'conj.': '접속사', 'interj.': '감탄사', 'det.': '한정사', 'num.': '수사', 'part.': '불변화사', 'pref.': '접두사', 'suf.': '접미사', 'phr.': '구', 'prop. n.': '고유명사' }

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`)
  return Buffer.from(await response.arrayBuffer())
}

// Use one inert DOM for parsing all bodies; no scripts or network resources run.
const dom = new JSDOM('<body></body>')
const host = dom.window.document.body
function parseEntry(headword, body) {
  host.innerHTML = body
  let pronunciation = ''
  const entries = []
  for (const block of host.children) {
    if (block.tagName !== 'DIV') throw new Error(`Unexpected entry structure: ${headword}`)
    if (!block.querySelector('b')) {
      pronunciation ||= block.textContent.trim()
      continue
    }
    const pos = block.firstElementChild?.tagName === 'I' ? block.firstElementChild.textContent.trim() : ''
    const senses = [...block.querySelectorAll('b')].map(bold => {
      const meaning = bold.textContent.trim()
      const next = bold.nextElementSibling
      const definition = next?.tagName === 'SPAN' ? next.textContent.replace(/^\s*—\s*/, '').trim() : ''
      if (!meaning) throw new Error(`Empty dictionary meaning: ${headword}`)
      return { meaning, ...(definition ? { definition } : {}) }
    })
    entries.push({ id: `${datasetVersion}:${headword}:${entries.length}`, headword,
      partOfSpeech: posNames[pos] ?? pos, pronunciation, senses,
      source: { datasetVersion, headword, url: `https://en.wiktionary.org/wiki/${encodeURIComponent(headword)}#English` } })
  }
  if (!entries.length) throw new Error(`No dictionary meanings: ${headword}`)
  return entries
}

// --archive allows reproducing from an already downloaded, hash-checked source.
const archiveArg = process.argv.indexOf('--archive')
const archive = archiveArg === -1 ? await download(sourceUrl) : await readFile(process.argv[archiveArg + 1])
if (sha256(archive) !== sourceSha256) throw new Error('Dictionary source SHA-256 mismatch')
const zip = await JSZip.loadAsync(archive)
async function member(name) {
  const file = zip.file(`en-ko/${name}`)
  if (!file) throw new Error(`Missing dictionary archive member: ${name}`)
  return file.async('nodebuffer')
}
const index = await member('en-ko.idx')
const definitions = gunzipSync(await member('en-ko.dict.dz'))
const synonyms = await member('en-ko.syn')
const words = []
const entries = []
for (let offset = 0; offset < index.length;) {
  const end = index.indexOf(0, offset)
  if (end < 0 || end + 9 > index.length) throw new Error('Invalid dictionary index')
  const headword = index.subarray(offset, end).toString('utf8')
  const start = index.readUInt32BE(end + 1)
  const size = index.readUInt32BE(end + 5)
  if (start + size > definitions.length) throw new Error('Invalid dictionary body offset')
  words.push(headword)
  entries.push(...parseEntry(headword, definitions.subarray(start, start + size).toString('utf8')))
  offset = end + 9
}
if (words.length !== 25_985) throw new Error(`Unexpected dictionary headword count: ${words.length}`)
const aliases = []
for (let offset = 0; offset < synonyms.length;) {
  const end = synonyms.indexOf(0, offset)
  if (end < 0 || end + 5 > synonyms.length) throw new Error('Invalid dictionary inflection index')
  const form = synonyms.subarray(offset, end).toString('utf8')
  const target = words[synonyms.readUInt32BE(end + 1)]
  if (!target) throw new Error('Invalid dictionary inflection target')
  aliases.push([key(form), key(target)])
  offset = end + 5
}
if (aliases.length !== 79_218) throw new Error(`Unexpected inflection count: ${aliases.length}`)

await mkdir(directory, { recursive: true })
const output = join(directory, 'en-ko.sqlite')
const temporary = join(dirname(output), '.en-ko.sqlite.tmp')
await rm(temporary, { force: true })
const db = new Database(temporary)
try {
  db.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA user_version = 1;
    CREATE TABLE entries (id TEXT PRIMARY KEY, headword TEXT NOT NULL, lookup_key TEXT NOT NULL, content TEXT NOT NULL);
    CREATE INDEX entries_lookup ON entries(lookup_key);
    CREATE TABLE aliases (lookup_key TEXT NOT NULL, headword_key TEXT NOT NULL, PRIMARY KEY(lookup_key, headword_key)) WITHOUT ROWID;
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
  `)
  const insert = db.prepare('INSERT INTO entries VALUES (?, ?, ?, ?)')
  const alias = db.prepare('INSERT OR IGNORE INTO aliases VALUES (?, ?)')
  db.transaction(() => {
    for (const entry of entries) insert.run(entry.id, entry.headword, key(entry.headword), JSON.stringify(entry))
    for (const row of aliases) alias.run(...row)
    db.prepare('INSERT INTO metadata VALUES (?, ?)').run('datasetVersion', datasetVersion)
  })()
  db.exec('VACUUM')
} finally {
  db.close()
  dom.window.close()
}
const bytes = await readFile(temporary)
await rename(temporary, output)
await writeFile(join(directory, 'UPSTREAM-ATTRIBUTION.txt'), await member('ATTRIBUTION'))
await writeFile(join(directory, 'manifest.json'), `${JSON.stringify({
  schemaVersion: 1, datasetVersion, sourceUrl, sourceSha256, sourceBytes: archive.length,
  license: 'CC-BY-SA-4.0', database: { file: 'en-ko.sqlite', sha256: sha256(bytes), bytes: bytes.length },
  counts: { headwords: words.length, entries: entries.length, inflectionRows: aliases.length, inflectedForms: new Set(aliases.map(row => row[0])).size },
  modifications: 'Converted StarDict HTML to structured senses and indexed SQLite; normalized lookup keys and translated part-of-speech labels. No generated translations.'
}, null, 2)}\n`)
console.log(`Built ${entries.length} entries from ${words.length} headwords: ${bytes.length} bytes (${sha256(bytes)})`)
