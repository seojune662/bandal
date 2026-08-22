import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { PipPlayerApp } from '../../../src/renderer/src/features/pip/PipPlayerApp'
import { PipToolbarApp } from '../../../src/renderer/src/features/pip/PipToolbarApp'

describe('PipPlayerApp', () => {
  test('renders the local video and complete player controls', () => {
    const html = renderToStaticMarkup(
      <PipPlayerApp
        courseId="course 한글"
        relPath="week 1/강의 영상.mp4"
        title="1주차 강의"
      />
    )

    expect(html).toContain('class="pip-player"')
    expect(html).toContain('class="pip-player__video"')
    expect(html).toContain(
      'src="bandal-media://material/course%20%ED%95%9C%EA%B8%80/week%201/%EA%B0%95%EC%9D%98%20%EC%98%81%EC%83%81.mp4"'
    )
    expect(html).not.toContain('autoplay')
    expect(html).toContain('aria-label="재생 위치"')
    expect(html).toContain('aria-label="재생 속도"')
    expect(html).toContain('aria-label="음량"')
    expect(html).toContain('aria-label="원래 화면으로 돌아가기"')
    expect(html).toContain('aria-label="미니 플레이어 닫기"')
    expect(html).toContain('0.5×')
    expect(html).toContain('2×')
  })
})

describe('PipToolbarApp', () => {
  test('renders the v1 web toolbar with restore and explicit close only', () => {
    const html = renderToStaticMarkup(<PipToolbarApp />)

    expect(html).toContain('class="pip-toolbar"')
    expect(html).toContain('aria-label="웹 미니 플레이어 컨트롤"')
    expect(html).toContain('aria-label="원래 화면으로 돌아가기"')
    expect(html).toContain('aria-label="미니 플레이어 닫기"')
    expect(html.match(/<button/g)).toHaveLength(2)
  })
})
