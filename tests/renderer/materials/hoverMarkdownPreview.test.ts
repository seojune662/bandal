// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { markdownPreviewFragment } from '../../../src/renderer/src/features/materials/preview/markdownPreview'

describe('read-only markdown hover rendering', () => {
  test('preserves headings and lists without creating embedded image requests or navigation', async () => {
    const fragment = await markdownPreviewFragment('# 강의 요약\n\n- 첫 내용\n- 다음 내용\n\n![첨부 그림](https://example.com/tracker.png)\n\n[참조](javascript:alert(1))')
    expect(fragment.querySelector('h1')?.textContent).toBe('강의 요약')
    expect(fragment.querySelectorAll('li')).toHaveLength(2)
    expect(fragment.querySelector('img, [src], [href]')).toBeNull()
    expect(fragment.textContent).toContain('[첨부 그림]')
  })

  test('truncates content before the headless parser receives it', async () => {
    const fragment = await markdownPreviewFragment('가'.repeat(1201))
    expect(fragment.textContent).toHaveLength(1200)
  })
})
