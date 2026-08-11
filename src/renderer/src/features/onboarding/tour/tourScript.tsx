import type { TourStep } from './tourTypes'

export const TOUR_STEPS = [
  {
    id: 'welcome',
    target: null,
    placement: 'bottom',
    title: '반달을 직접 둘러볼까요?',
    body: (
      <p>
        실제 화면을 하나씩 짚어드릴게요. 둘러보는 동안 임시 과목과 환영
        노트가 만들어지고, 끝나면 모두 정리돼요.
      </p>
    ),
    before: null,
    nextLabel: '둘러보기 시작'
  },
  {
    id: 'courses',
    target: 'course-sidebar',
    placement: 'right',
    title: '과목은 진짜 폴더예요',
    body: (
      <p>
        과목 하나가 컴퓨터의 폴더 하나와 연결돼요. 폴더 그룹을 만들면 학기나
        관심 분야별로 과목을 묶을 수 있어요.
      </p>
    ),
    before: null,
    nextLabel: null
  },
  {
    id: 'materials',
    target: 'materials-import',
    placement: 'left',
    title: '자료를 바로 모아보세요',
    body: (
      <p>
        Finder에서 파일을 끌어오거나 <kbd>⌘V</kbd>로 붙여 넣을 수 있어요.
        폴더를 만들어 자료를 원하는 위치로 옮겨도 돼요.
      </p>
    ),
    before: null,
    nextLabel: null
  },
  {
    id: 'tabs',
    target: 'tab-strip',
    placement: 'bottom',
    title: '모든 공부 도구는 탭으로',
    body: (
      <p>
        필기·PDF·브라우저·AI를 한 탭 막대에서 열어요. 탭을 끌면 화면을
        나누어 자료를 나란히 볼 수도 있어요.
      </p>
    ),
    before: 'open-seed-note',
    nextLabel: null
  },
  {
    id: 'favorites',
    target: 'favorites-section',
    placement: 'right',
    title: '자주 쓰는 탭은 즐겨찾기로',
    body: (
      <p>
        열린 탭을 즐겨찾기 영역으로 끌어다 놓으면 언제든 다시 열 수 있게
        고정돼요.
      </p>
    ),
    before: null,
    nextLabel: null
  },
  {
    id: 'assistant',
    target: 'assistant-panel',
    placement: 'left',
    title: '과목 자료를 읽는 AI 튜터',
    body: (
      <p>
        현재 과목의 자료를 바탕으로 질문에 답해요. 새 대화를 시작하거나 대화
        목록에서 이전 공부를 이어갈 수 있어요.
      </p>
    ),
    before: 'open-assistant',
    nextLabel: null
  },
  {
    id: 'search',
    target: null,
    placement: 'bottom',
    title: '키보드로 더 빠르게 찾아요',
    body: (
      <p>
        <kbd>⌘P</kbd>는 파일 이름을, <kbd>⇧⌘F</kbd>는 자료 속 내용을
        검색해요. 과목이 커져도 필요한 곳으로 바로 이동할 수 있어요.
      </p>
    ),
    before: null,
    nextLabel: null
  },
  {
    id: 'finale',
    target: null,
    placement: 'bottom',
    title: '준비가 끝났어요',
    body: (
      <p>
        앱 안 브라우저의 로그인은 자동으로 유지되고, 함께하기에서 친구들과
        공부를 이어갈 수 있어요. 임시 과목은 지금 정리할게요.
      </p>
    ),
    before: null,
    nextLabel: '끝내기'
  }
] as const satisfies readonly TourStep[]

export const TOUR_STEP_COUNT = TOUR_STEPS.length
