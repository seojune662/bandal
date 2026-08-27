import { describe, expect, test } from 'vitest'
import {
  AGENT_TOOL_NAMES,
  BROWSER_TOOL_NAMES
} from '../../../src/main/features/agentTools/schemas'
import { BUILTIN_PACKS } from '../../../src/shared/workflowPacks/builtins'
import { sanitizeWorkflowPack } from '../../../src/shared/workflowPacks/sanitize'
import { WORKFLOW_PACK_ALLOWED_TOOL_NAMES } from '../../../src/shared/workflowPacks/toolNames'

const VOCAB_CHAIN_RECIPE = [
  '영어 원문을 읽고 어휘 사슬 한 회차를 진행하라. 아래 단계를 순서대로 수행하라.',
  '1. 대상(파일 또는 지정된 웹 페이지)을 정독하고, 대학생 학습자에게 어려운 단어 10~20개를 골라라. 각 단어마다 한국어 뜻과, 그 단어가 실제로 쓰인 원문 문장을 그대로 기록하라.',
  '2. `영어 학습/단어장.md`가 없으면 만들고, 있으면 먼저 읽은 뒤 끝에 이어 붙여라. 형식은 마크다운 표 `| 단어 | 뜻 | 원문 예문 | 출처 |` 하나를 계속 키운다. 이미 표에 있는 단어는 새 행을 만들지 말고 그 행의 예문·출처만 보강하라. 출처 칸에는 대상 문서로 가는 마크다운 링크 `[제목](bandal://material?path=URL인코딩된-과목상대경로)` 를 넣고, 웹 페이지가 대상이면 원문 URL 을 넣어라.',
  '3. WebSearch 로, 2에서 고른 단어 중 여러 개가 실제로 등장할 만한 새 영어 기사 2~3개를 찾아라. 무료로 전문이 읽히는 뉴스·에세이·과학 기사만 고르고, WebFetch 로 본문을 확인해 학습 단어가 실제로 몇 개 등장하는지 세어라. 확인되지 않은 기사는 버려라.',
  '4. 확인된 기사마다 `영어 학습/기사/` 아래에 마크다운 노트를 write_file 로 저장하라. 내용: 제목, 원문 URL, 등장하는 학습 단어 목록(등장 문장 포함), 두세 문단 발췌. 파일명은 기사 제목을 짧게 줄인 것으로 하라.',
  '5. 새 기사 노트 각각의 상단에 `[출발 문서](bandal://material?path=…)` 와 `[단어장](bandal://material?path=영어%20학습/단어장.md)` 링크를 넣고, link_materials 도구로 각 새 기사 노트와 출발 문서를 연결하라. 사슬은 이 링크로 이어진다.',
  '6. 지정된 결과 파일(리포트)에는 이번 회차 요약을 저장하라: 고른 단어 목록, 저장한 기사 목록(학습 단어 등장 수 포함), 다음에 읽을 기사 추천 1개와 그 이유. 채팅 답변 마지막에도 같은 추천을 한 줄로 알려 줘라.'
].join('\n')

describe('BUILTIN_PACKS', () => {
  test('contains the seven stable study ids plus vocab-chain-en exactly once', () => {
    const ids = BUILTIN_PACKS.map((pack) => pack.id)

    expect(ids).toEqual([
      'summary',
      'quiz',
      'flashcards',
      'mindmap',
      'structured-notes',
      'exam-predictions',
      'explain',
      'vocab-chain-en'
    ])
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every built-in passes the import boundary schema unchanged', () => {
    for (const pack of BUILTIN_PACKS) {
      const sanitized = sanitizeWorkflowPack(pack)
      expect(sanitized.pack, pack.id).toEqual(pack)
      expect(sanitized.warnings, pack.id).toEqual([])
    }
  })

  test('keeps the shared tool-name mirror equal to the main schemas catalog', () => {
    expect(new Set(WORKFLOW_PACK_ALLOWED_TOOL_NAMES)).toEqual(
      new Set([...AGENT_TOOL_NAMES, ...BROWSER_TOOL_NAMES])
    )
  })

  test('keeps legacy packs local, Korean, and on the existing output contract', () => {
    for (const pack of BUILTIN_PACKS.slice(0, 7)) {
      expect(pack.author).toBe('Bandal')
      expect(pack.version).toBe('1.0.0')
      expect(pack.locale).toBe('ko-KR')
      expect(pack.usesWeb).toBe(false)
      expect(pack.outputs.dir).toBe('AI 학습자료')
      expect(pack.allowedTools).toEqual(
        expect.arrayContaining(['create_note', 'write_file'])
      )
    }
    expect(BUILTIN_PACKS.find((pack) => pack.id === 'explain')?.worksOn)
      .not.toContain('course')
  })

  test('preserves the vocab chain recipe and follow-up verbatim', () => {
    const pack = BUILTIN_PACKS.find((candidate) => candidate.id === 'vocab-chain-en')

    expect(pack?.recipe).toBe(VOCAB_CHAIN_RECIPE)
    expect(pack).toMatchObject({
      name: '영어 단어 사슬',
      description:
        '기사에서 어려운 단어를 모으고, 그 단어가 쓰인 다음 기사로 이어가요.',
      worksOn: ['material', 'browser-tab'],
      allowedTools: [
        'write_file',
        'create_note',
        'send_web_clip_to_note',
        'link_materials',
        'list_links'
      ],
      usesWeb: true,
      outputs: { dir: '영어 학습', primary: '단어 사슬 리포트' },
      followUp: {
        label: '이 기사로 이어가기',
        recipe:
          '이번 실행은 어휘 사슬의 다음 회차다. 대상 파일은 이전 회차가 저장한 기사 노트다. 노트에 적힌 원문 URL 을 WebFetch 로 다시 읽고, 위 1~6단계를 그대로 반복하라. 단어장은 같은 `영어 학습/단어장.md` 에 이어 붙이고, 새 기사 노트의 링크(5단계)는 이번 대상 노트를 출발 문서로 가리키게 하라. 리포트에는 사슬이 몇 번째 회차인지도 적어라.'
      }
    })
  })
})
