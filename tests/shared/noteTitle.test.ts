import { expect, test } from 'vitest'
import { firstNoteTitle, replaceNoteTitle } from '../../src/shared/noteTitle'

test('keeps fenced code and shell comments intact during note renames', () => {
  const code = '```bash\n# example comment\necho hello\n```\n\n'
  expect(firstNoteTitle(code + '# Real title\n\nbody')).toBe('Real title')
  expect(replaceNoteTitle(code + '# Real title\n\nbody', 'New title')).toBe(code + '# New title\n\nbody')
  expect(firstNoteTitle(code)).toBeNull()
  expect(replaceNoteTitle(code, 'New title')).toBe('# New title\n\n' + code)
})
test('ignores shorter and mismatched fences inside a code sample', () => {
  const markdown = '````md\n```\n# sample\n~~~\n````\n# Real'
  expect(firstNoteTitle(markdown)).toBe('Real')
  expect(firstNoteTitle('~~~\n# sample\n~~~~\n# Real')).toBe('Real')
})
test('does not consume the next line after an empty heading', () => {
  expect(firstNoteTitle('#\nBody text')).toBeNull()
  expect(replaceNoteTitle('#\nBody text', 'Title')).toBe('# Title\nBody text')
})
test('recognizes optional closing hashes and up to three spaces of indentation', () => {
  expect(firstNoteTitle('   # Heading ###')).toBe('Heading')
  expect(firstNoteTitle('    # code\n\n# Real')).toBe('Real')
})
test('preserves metadata and literal HTML/comments', () => {
  const metadata = '---\ntitle: Metadata\n# not a heading\n---\n'
  const html = '<!--\n# comment\n-->\n<pre>\n# example\n</pre>\n'
  expect(firstNoteTitle(metadata + html + '# Real')).toBe('Real')
  expect(replaceNoteTitle(metadata, 'Title')).toBe('---\ntitle: Metadata\n# not a heading\n---\n\n# Title\n\n')
})

test('does not hide headings following ordinary thematic rules', () => {
  expect(firstNoteTitle('---\n# Heading\ntext')).toBe('Heading')
  expect(firstNoteTitle('---\n# Heading\n---')).toBe('Heading')
})
