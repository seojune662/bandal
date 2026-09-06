import { describe, expect, test } from 'vitest'
import {
  parseBookmarkHtml,
  parsePasswordCsv
} from '../../../src/main/features/browser/browserImport'

describe('browser imports', () => {
  test('parses quoted Chrome-family password CSV fields', () => {
    const result = parsePasswordCsv(
      '\uFEFFname,url,username,password,note\n' +
      'Portal,https://portal.example.edu/login,"student,1","p""ass",\n' +
      'Empty,https://empty.example.edu,user,,\n'
    )
    expect(result.logins).toEqual([{
      origin: 'https://portal.example.edu/login',
      username: 'student,1',
      password: 'p"ass',
      autoSubmit: false
    }])
    expect(result.skipped).toBe(1)
  })

  test('accepts Firefox hostname headers and quoted newlines', () => {
    const result = parsePasswordCsv(
      'hostname,username,password\n"https://example.edu/","student\nnumber",secret\n'
    )
    expect(result.logins[0]?.username).toBe('student\nnumber')
  })

  test('rejects CSVs without required columns', () => {
    expect(() => parsePasswordCsv('name,address,login\nA,B,C')).toThrow(
      'url, username, password'
    )
  })

  test('parses Netscape bookmark exports and drops unsafe schemes', () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
      <DL><p>
        <DT><A HREF="https://example.edu/a?x=1&amp;y=2">School &amp; Portal</A>
        <DT><A HREF="javascript:alert(1)">Unsafe</A>
        <DT><A HREF="http://localhost:3000/">Local</A>
      </DL>`
    expect(parseBookmarkHtml(html)).toEqual([
      { title: 'School & Portal', url: 'https://example.edu/a?x=1&y=2' },
      { title: 'Local', url: 'http://localhost:3000/' }
    ])
  })
})
