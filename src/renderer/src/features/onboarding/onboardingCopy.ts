import type { Locale } from '../../i18n'
import { getLocale } from '../../i18n/localeStore'

const ko = {
  welcome: '반달에 오신 걸 환영해요',
  description: '자료를 읽고, 질문하고, 복습하는 공부 공간입니다.',
  tour: '핵심 기능 5개 보기',
  direct: '바로 시작하기',
  close: '안내 닫기',
  tourDescription: '예시 과목으로 실제 화면을 보여드리며, 질문 전송이나 AI 생성은 실행하지 않아요. 끝내거나 건너뛰면 예시 자료는 모두 정리됩니다.',
  offer: '핵심 기능 5개를 살펴보세요',
  preparing: '예시 자료를 준비하는 중…',
  cleaning: '예시 자료를 정리하는 중…',
  next: '다음', previous: '이전', skip: '건너뛰기', finish: '끝내기', later: '나중에',
  moving: '화면을 여는 중…', progress: '튜토리얼 진행 단계', current: '현재 단계',
  missing: '이 화면이 보이지 않아도 설명을 읽고 다음으로 넘어갈 수 있어요.',
  dataRoot: '예시 자료를 저장할 위치를 설정해 주세요.',
  startFailed: '안내를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.',
  cleanupFailed: '예시 자료를 정리하지 못했어요. 끝내기를 다시 눌러 주세요.',
  saveFailed: '안내 선택을 저장하지 못했어요. 다시 시도해 주세요.',
  courseName: '반달 튜토리얼', noteName: '예시 필기.md', pdfName: '예시 강의자료.pdf',
  seedNote: '# 예시 필기\n\nPDF를 보며 핵심 내용을 여기에 정리해 보세요. 필기는 자동으로 저장됩니다.\n\n이 과목과 자료는 튜토리얼이 끝나면 정리됩니다.\n',
  materialsTitle: '과목에 자료 모으기',
  materialsBody: '과목마다 자료와 필기를 한 폴더에 모을 수 있어요. 자료 가져오기를 누르거나 파일을 끌어오면 목록에 저장됩니다.',
  readingTitle: 'PDF를 읽고 필기하기',
  readingBody: 'PDF와 필기를 나란히 열어 읽으면서 정리하세요. PDF에 하이라이트와 메모를 남길 수 있고, 필기는 자동으로 저장됩니다.',
  assistantTitle: '현재 자료에 대해 AI에게 질문하기',
  assistantBody: '오른쪽 AI에서 현재 자료를 바탕으로 대화하세요. 부분 선택으로 여러 문서의 원하는 곳을 질문에 첨부할 수 있어요. 질문은 보내기를 눌러야 전송됩니다.',
  reviewTitle: '내 자료로 퀴즈와 카드 만들기',
  reviewBody: '같은 대화에서 퀴즈·플래시카드·예상 문제 모드로 전환하세요. 원하는 내용을 적고 자료를 첨부해 보내면 결과가 대화에 남고, 별도 탭에서 풀거나 복습할 수 있어요.',
  englishTitle: '프로젝트에서 이어서 공부하기',
  englishBody: '홈의 프로젝트 탭에서 영어 읽기나 과목 복습 공간을 만드세요. 과목과 같은 폴더 구조로 관리하며, 글·단어장·퀴즈·카드를 각각 열어 이어서 공부할 수 있어요.'
}
const en: typeof ko = {
  welcome: 'Welcome to Bandal', description: 'A study space to read, ask questions, and review.',
  tour: 'Explore 5 key features', direct: 'Start using Bandal', close: 'Close introduction',
  tourDescription: 'Explore the real interface with a sample course without sending questions or running AI generation. Its sample files are removed when you finish or skip.',
  offer: 'Explore 5 key features', preparing: 'Preparing sample files…', cleaning: 'Removing sample files…',
  next: 'Next', previous: 'Back', skip: 'Skip tour', finish: 'Finish', later: 'Later', moving: 'Opening the view…',
  progress: 'Tutorial progress', current: 'current step',
  missing: 'You can read this explanation and continue even when the view is unavailable.',
  dataRoot: 'Choose a location for the sample files first.', startFailed: 'Could not start the tour. Please try again shortly.',
  cleanupFailed: 'Could not remove the sample files. Select Finish again.', saveFailed: 'Could not save your choice. Please try again.',
  courseName: 'Bandal tutorial', noteName: 'Sample notes.md', pdfName: 'Sample lecture.pdf',
  seedNote: '# Sample notes\n\nWrite down the key points while reading the PDF. Notes save automatically.\n\nThis course and its files are removed when the tour ends.\n',
  materialsTitle: 'Collect materials by course',
  materialsBody: 'Keep each course’s materials and notes in one folder. Import files or drag them into the materials list to save them there.',
  readingTitle: 'Read PDFs and take notes',
  readingBody: 'Read your PDF beside your notes. Highlight passages and add comments to the PDF; your notes save automatically.',
  assistantTitle: 'Ask AI about the current material',
  assistantBody: 'Use AI on the right to discuss your current material. Select parts of several documents to attach to your question. Nothing is sent until you select Send.',
  reviewTitle: 'Create quizzes and flashcards from your material',
  reviewBody: 'Switch the same conversation to Quiz, Flashcards, or Predicted questions. Describe what you need and attach sources, then send. Results stay in the conversation and open in their own tabs for practice.',
  englishTitle: 'Continue studying in projects',
  englishBody: 'Create English reading or course review spaces from the Projects home tab. Organize them like course folders and open articles, vocabulary, quizzes, and cards in separate tabs to keep studying.'
}
export function onboardingCopy(locale: Locale = getLocale()): typeof ko {
  return locale === 'en-US' ? en : ko
}
