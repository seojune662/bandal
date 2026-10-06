# 학습 기능 검토 — 2026-10-07

## 범위와 가설

| 범위 | 검토 내용 |
| --- | --- |
| 생성/목록/이동 | LearningCreateDialog, NewLearningDialog, LearningGenerationDialog, LearningAISelector, LearningProjects, LearningHome, LearningSpacesPanel, LearningSpaceManagement, learningActions/navigation/purpose/presentation. 목적·원본 과목·AI 선택, 빈 목록과 불러오기 실패, 이전 응답의 차단, 복제/이동 프로젝트 식별, 삭제 전 저장과 복원 검토 |
| 작업 상태 | LearningTab, LearningRunStatus/runPresentation, main learningRuntime/learningFailures/approvalDialogs/learningAgent. 생성 직후 실패, 새 run과 과거 이력 구분, pause/cancel/retry, 중복 작업, 실패 재분류, 제한된 산출물 검증 확인 |
| 읽기/단어 | LearningReader, readerSelection, LearningSources, main articleExtractor/articleNetwork. 선택 범위·중복 단어·원문 offset, 출처 이동, 저장/문맥 설명, 읽기 완료, 익명 추출 취소와 세션 회수, DNS/redirect/credential 경계 확인 |
| 퀴즈/카드/가져오기 | LearningReview, LearningDraftPreview, LearningMaterialImportDialog, main validation/model/learningRepo. 미완료 답과 자기 확인, 저장 실패/정답 노출/완료 순서, 카드 재평가 idempotency와 복습 시각, 기존 기록 보존, 미리보기 검증 확인 |
| 저장/자료 검증 | learningRepo, learningCache, learningGrounding, materialSource. 원자적 state/previous, revision 충돌, immutable snapshot hash, 원문 인용과 연결 과목, 심볼릭 링크 경계, 사용자 Markdown 보존, 파생 cache 검토 |

검토는 코드 경로와 자동 회귀로 범위를 구분했다. 실제 모든 AI 계정·원격 기사·임의 문서에 대한 실행을 의미하지 않는다.

## 확인한 문제와 수정

1. **새 AI 작업의 즉시 실패가 숨겨짐**: 새 학습 탭이 초기 snapshot을 받기 전에 첫 run이 실패하면 과거 이력으로 분류되어 실패 안내가 나타나지 않았다. renderer에서 새 run ID를 생성/재시도/Reader/launcher 진입점마다 기록하고 대상 프로젝트 snapshot에 도착하면 소비한다. 처음 시작한 실패는 표시하며, 이미 본 실패를 재방문할 때 조용한 이력으로 두는 정책은 유지한다.
2. **빈칸 답을 지워도 이전 답이 남음**: main 저장 검증이 빈 cloze 답을 거부했다. 사용자가 답을 지운 화면과 저장된 이전 답이 달라 잘못 채점될 수 있었다. 자유 입력 답은 빈 초안을 저장하고, UI/완료 검증은 비어 있거나 자기 확인이 끝나지 않은 답의 채점을 막는다. 로컬 변경이 아직 저장되기 전에도 이전 답의 자기 확인을 재사용하지 않는다.
3. **다른 문제의 성공이 실패한 답의 채점을 허용**: q1 저장 실패 후 q2가 성공하면 마지막 Promise만 기다리고 이전 q1 답으로 채점할 수 있었다. 문항별 실패 초안을 보존하고 ‘답 다시 저장’을 제공한다. 채점은 모든 실패 초안의 재저장까지 성공해야 진행한다. 중복 채점 클릭과 채점 중 자기 확인 변경도 막는다.
4. **PDF 출처의 페이지가 무시됨**: ‘7쪽’ 등의 학습 출처 버튼이 파일만 열었다. 원본 과목의 실제 경로로 연 다음 기존 PDF 페이지 전달 큐에 인용 페이지를 넣어 아직 로드되지 않은 PDF도 해당 페이지로 이동한다.
5. **자료 전환 세션 경계 보강**: 프로젝트 binding과 Reader article ID를 React key로 분리해 이전 프로젝트·기사의 비동기 상태가 다음 자료의 선택/진행 UI를 덮지 않도록 한다.
6. **읽기 완료 버튼 문구 불일치**: 과목 복습의 기사에도 ‘다음 글 찾기’를 표시했지만 실제 자동 추천은 설정을 확인한 영어 읽기에만 실행했다. 실제 동작에 맞춰 ‘읽기 완료’ 또는 ‘읽기 완료 · 다음 글 찾기’를 표시한다.

## 검증

- `pnpm exec vitest run tests/renderer/learning tests/main/learning/learningRepo.test.ts`: 당시 6파일/53검사 통과.
- `pnpm exec vitest run tests/renderer/learning/learningQuiz.test.tsx tests/renderer/learning/learning-models.test.ts`: 2파일/10검사 통과. 실제 React UI에서 저장 실패 → 다른 답 성공 → 채점 차단 → 실패 답 재저장 → 채점 성공을 확인했다.
- `pnpm exec vitest run tests/renderer/learning/learningSources.test.tsx`: 1검사 통과. 다른 원본 과목의 PDF와 아직 초기화되지 않은 뷰어에 페이지 전달을 확인했다.
- `pnpm exec vitest run tests/main/learning`: 13파일/149검사 중 143통과, 6검사는 샌드박스가 127.0.0.1 listen을 금지해 실패. 해당 두 파일만 권한 범위에서 재실행(`tests/main/learning/articleNetwork.test.ts tests/main/learning/articleExtractor.test.ts`)하여 32검사 모두 통과했다.
- 마지막 자기 확인 보강은 `tests/renderer/canvas/canvasSaveQueue.test.ts tests/renderer/learning/learning-models.test.ts tests/renderer/learning/learningQuiz.test.tsx` 합계 15검사로 검증했다.

## 외부·실기기 검증 한계

- 실제 Claude/Codex/Gemini 로그인·요금제별 모델 권한 및 온라인 생성 품질은 이 로컬 회귀에서 실행하지 않았다.
- 기사 사이트의 일시적 로그인/구독 UI, 프록시/네트워크 정책, CAPTCHA와 모든 redirect 조합은 fixture와 mock 경계 외 별도 검증이 필요하다.
- 모니터/키보드/스크린리더에서 모든 장면을 수동 조작한 것은 아니다. 문구·포커스 호출·기본 Enter/Space 선택·버튼 비활성화 경로를 코드로 확인했다.
- 저장 실패한 메모리 초안은 다시 저장 전에 앱 강제 종료하면 영구 보존되지 않는다.
- 통합 타입 검사, 실제 패키지 E2E와 배포는 root가 수행한다.
